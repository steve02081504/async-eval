import { importPackage } from './base.mjs'

export const { parse, tokenizer, parseExpressionAt } = await importPackage('acorn')
