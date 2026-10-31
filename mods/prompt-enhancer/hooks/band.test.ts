import { expect, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } } as const

test('the band offers Enhance and stays idle on an empty draft', async ($, on) => {
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }) as never)
  const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ key: 'enhance' })).toBeDefined()
  await ui.press({ key: 'enhance' })
  expect(await ui.find({ key: 'enhance' })).toBeDefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  await ui.unmount()
})
