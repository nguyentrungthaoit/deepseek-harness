/** The package's Host half registers nothing; the panel runs in the browser. */
import { expect, it } from 'vitest'
import { apply } from '../src/index.ts'

it('contributes nothing to the Host tree', () => {
  expect(apply).not.toThrow()
})
