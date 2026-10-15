import { expect, test } from 'vitest'
import { isRtl } from '../src/i18n/rtl'

test.each(['ar', 'he', 'fa-IR', 'ur', 'ckb', 'az-Arab', 'ps'])('%s is right-to-left', (l) => expect(isRtl(l)).toBe(true))
test.each(['en', 'sk', 'pt-BR', 'zh-Hant', 'sd-Deva', 'de'])('%s is left-to-right', (l) => expect(isRtl(l)).toBe(false))
