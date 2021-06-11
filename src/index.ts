import { PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { readBigInt64LE, readBigUInt64LE } from './readBig'

export const Magic = 0xa1b2c3d4
export const Version1 = 1
export const Version = Version1
export const PriceStatus = ['Unknown', 'Trading', 'Halted', 'Auction']
export const CorpAction = ['NoCorpAct']
export const PriceType = ['Unknown', 'Price', 'TWAP', 'Volatility']

const empty32Buffer = Buffer.alloc(32)
const PKorNull = (data: Buffer) => (data.equals(empty32Buffer) ? null : new PublicKey(data))

export interface Base {
  magic: number;
  version: number;
  type: number;
  size: number;
}

export interface MappingData extends Base {
  nextMappingAccount: PublicKey | null;
  productAccountKeys: PublicKey[],
}

export interface Product {
  symbol: string;
  asset_type: string;
  quote_currency: string;
  tenor: string;
  [index: string]: string
}

export interface ProductData extends Base {
  priceAccountKey: PublicKey;
  product: Product,
}

export interface Price {
  priceComponent: bigint;
  price: number;
  confidenceComponent: bigint;
  confidence: number;
  status: number;
  corporateAction: number;
  publishSlot: bigint;
}

export interface PriceComponent {
  publisher: PublicKey | null;
  aggregate: Price;
  latest: Price;
}

export interface PriceData extends Base, Price {
  priceType: number;
  exponent: number;
  numComponentPrices: number;
  currentSlot: bigint;
  validSlot: bigint;
  productAccountKey: PublicKey;
  nextPriceAccountKey: PublicKey | null;
  aggregatePriceUpdaterAccountKey: PublicKey;
  priceComponents: PriceComponent[]
}

export const parseMappingData = (data: Buffer): MappingData => {
  // pyth magic number
  const magic = data.readUInt32LE(0)
  // program version
  const version = data.readUInt32LE(4)
  // account type
  const type = data.readUInt32LE(8)
  // account used size
  const size = data.readUInt32LE(12)
  // number of product accounts
  const numProducts = data.readUInt32LE(16)
  // unused
  // const unused = accountInfo.data.readUInt32LE(20)
  // TODO: check and use this
  // next mapping account (if any)
  const nextMappingAccount = PKorNull(data.slice(24, 56))
  // read each symbol account
  let offset = 56
  const productAccountKeys: PublicKey[] = []
  for (let i = 0; i < numProducts; i++) {
    const productAccountBytes = data.slice(offset, offset + 32)
    const productAccountKey = new PublicKey(productAccountBytes)
    offset += 32
    productAccountKeys.push(productAccountKey)
  }
  return {
    magic,
    version,
    type,
    size,
    nextMappingAccount,
    productAccountKeys,
  }
}

export const parseProductData = (data: Buffer): ProductData => {
  // pyth magic number
  const magic = data.readUInt32LE(0)
  // program version
  const version = data.readUInt32LE(4)
  // account type
  const type = data.readUInt32LE(8)
  // price account size
  const size = data.readUInt32LE(12)
  // first price account in list
  const priceAccountBytes = data.slice(16, 48)
  const priceAccountKey = new PublicKey(priceAccountBytes)
  const product = {} as Product
  let idx = 48
  while (idx < size) {
    const keyLength = data[idx]
    idx++
    if (keyLength) {
      const key = data.slice(idx, idx + keyLength).toString()
      idx += keyLength
      const valueLength = data[idx]
      idx++
      const value = data.slice(idx, idx + valueLength).toString()
      idx += valueLength
      product[key] = value
    }
  }
  return { magic, version, type, size, priceAccountKey, product }
}

const parsePriceInfo = (data: Buffer, exponent: number): Price => {
  // aggregate price
  const priceComponent = readBigInt64LE(data, 0)
  const price = Number(priceComponent) * 10 ** exponent
  // aggregate confidence
  const confidenceComponent = readBigUInt64LE(data, 8)
  const confidence = Number(confidenceComponent) * 10 ** exponent
  // aggregate status
  const status = data.readUInt32LE(16)
  // aggregate corporate action
  const corporateAction = data.readUInt32LE(20)
  // aggregate publish slot
  const publishSlot = readBigUInt64LE(data, 24)
  return {
    priceComponent,
    price,
    confidenceComponent,
    confidence,
    status,
    corporateAction,
    publishSlot,
  }
}

export const parsePriceData = (data: Buffer): PriceData => {
  // pyth magic number
  const magic = data.readUInt32LE(0)
  // program version
  const version = data.readUInt32LE(4)
  // account type
  const type = data.readUInt32LE(8)
  // price account size
  const size = data.readUInt32LE(12)
  // price or calculation type
  const priceType = data.readUInt32LE(16)
  // price exponent
  const exponent = data.readInt32LE(20)
  // number of component prices
  const numComponentPrices = data.readUInt32LE(24)
  // unused
  // const unused = accountInfo.data.readUInt32LE(28)
  // currently accumulating price slot
  const currentSlot = readBigUInt64LE(data, 32)
  // valid on-chain slot of aggregate price
  const validSlot = readBigUInt64LE(data, 40)
  // product id / reference account
  const productAccountKey = new PublicKey(data.slice(48, 80))
  // next price account in list
  const nextPriceAccountKey = PKorNull(data.slice(80, 112))
  // aggregate price updater
  const aggregatePriceUpdaterAccountKey = new PublicKey(data.slice(112, 144))
  const aggregatePriceInfo = parsePriceInfo(data.slice(144, 176), exponent)
  // price components - up to 16
  const priceComponents: PriceComponent[] = []
  let offset = 176
  let shouldContinue = true
  while (offset < data.length && shouldContinue) {
    const publisher = PKorNull(data.slice(offset, offset + 32))
    offset += 32
    if (publisher) {
      const aggregate = parsePriceInfo(data.slice(offset, offset + 32), exponent)
      offset += 32
      const latest = parsePriceInfo(data.slice(offset, offset + 32), exponent)
      offset += 32
      priceComponents.push({ publisher, aggregate, latest })
    } else {
      shouldContinue = false
    }
  }
  return {
    magic,
    version,
    type,
    size,
    priceType,
    exponent,
    numComponentPrices,
    currentSlot,
    validSlot,
    productAccountKey,
    nextPriceAccountKey,
    aggregatePriceUpdaterAccountKey,
    ...aggregatePriceInfo,
    priceComponents,
  }
}
