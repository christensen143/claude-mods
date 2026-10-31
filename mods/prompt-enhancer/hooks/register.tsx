import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EnhanceStatus } from '../types'

const MODEL = 'sonnet'
const MAX_CLAUDE_MD = 12000
const MAX_SKILLS = 120

const status = atom({ plugin: 'prompt-enhancer', key: 'status' } as const, 'idle' as EnhanceStatus)
const original = atom({ plugin: 'prompt-enhancer', key: 'original' } as const, '')
const enhanced = atom({ plugin: 'prompt-enhancer', key: 'enhanced' } as const, '')

const SYSTEM = `You rewrite a developer's rough draft into a precise prompt for Claude Code, an agent working inside the project described below.

Rules:
- Keep the developer's intent and scope exactly. Never add features, files or goals they did not imply.
- Make it specific: name the likely files, directories, commands, models or conventions from the project context, and state the expected outcome and how to verify it.
- If a listed skill clearly fits the task, say to use it by name (for example "Use the superpowers:systematic-debugging skill"). Do not mention skills that do not fit.
- Respect the project's own workflow rules (branching, tests, changelog, etc.) by naming them only when relevant to this task.
- Do not invent facts. If something essential is unknown, say to find it in the codebase first rather than guessing.
- Write in the developer's voice, imperative, concise. No preamble.
- Output ONLY the rewritten prompt text. No quotes, no markdown fences, no commentary.`

async function tryRead($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function skillsIn($: EngineInterface, dir: string): Promise<string[]> {
  const lines: string[] = []
  try {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'dir') continue
      const body = await tryRead($, `${dir}/${entry.name}/SKILL.md`)
      if (body === null) continue
      const desc = /^description:\s*(.+)$/m.exec(body)?.[1]?.trim().slice(0, 200) ?? ''
      lines.push(`- ${entry.name}: ${desc}`)
    }
  } catch {
    // directory absent
  }
  return lines
}

async function gatherContext($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  let home = ''
  try {
    const r = await $.process.run({ argv: ['sh', '-c', 'printf %s "$HOME"'] })
    home = String((r as { stdout?: string }).stdout ?? '').trim()
  } catch {
    home = ''
  }

  const parts: string[] = []
  const files: [string, string][] = [
    ['Project CLAUDE.md', `${cwd}/CLAUDE.md`],
    ['Project .claude/CLAUDE.md', `${cwd}/.claude/CLAUDE.md`],
  ]
  if (home) files.push(['User CLAUDE.md', `${home}/.claude/CLAUDE.md`])
  for (const [label, path] of files) {
    const text = await tryRead($, path)
    if (text) parts.push(`## ${label}\n${text.slice(0, MAX_CLAUDE_MD)}`)
  }

  const dirs = [`${cwd}/.claude/skills`]
  if (home) dirs.push(`${home}/.claude/skills`)
  const skills = (await Promise.all(dirs.map(d => skillsIn($, d)))).flat().slice(0, MAX_SKILLS)
  if (skills.length) parts.push(`## Installed skills\n${skills.join('\n')}`)

  return parts.join('\n\n') || '(no project instructions found)'
}

async function enhance($: EngineInterface) {
  const box = await $.prompt.read()
  const draft = box.text.trim()
  if (!draft) {
    $.ui.toast('Type a rough prompt first, then press Enhance.')
    return
  }
  await update($, status, () => 'working')
  try {
    const context = await gatherContext($)
    const r = await $.model.complete({
      model: MODEL,
      system: `${SYSTEM}\n\n# Project context\n${context}`,
      prompt: `Rough draft:\n${draft}`,
      maxTokens: 1500,
    })
    if (!r.isAnswered) {
      $.ui.toast(`Enhance failed (${r.reason}). Your draft is unchanged.`)
      await update($, status, () => 'idle')
      return
    }
    const text = r.text.trim()
    await update($, original, () => draft)
    await update($, enhanced, () => text)
    await $.prompt.fill({ text, mode: 'replace' })
    await update($, status, () => 'ready')
  } catch (error) {
    $.ui.toast(`Enhance failed: ${error instanceof Error ? error.message : String(error)}`)
    await update($, status, () => 'idle')
  }
}

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = await read($, status)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (state === 'working') {
      return (
        <Box>
          <Text dimColor>Enhancing your prompt with project context…</Text>
        </Box>
      )
    }

    if (state === 'ready') {
      return (
        <Box>
          <Text dimColor>Enhanced. Edit the box if you like. </Text>
          <Button
            key="send"
            label="Send"
            onPress={async () => {
              const { text } = await $.prompt.read()
              const final = text.trim()
              if (!final) return
              await update($, status, () => 'idle')
              await $.prompt.fill({ text: '', mode: 'replace' })
              void $.prompt.submit({ text: final })
            }}
          />
          <Text> </Text>
          <Button
            key="revert"
            label="Revert"
            onPress={async () => {
              const before = await read($, original)
              await $.prompt.fill({ text: before, mode: 'replace' })
              await update($, status, () => 'idle')
            }}
          />
        </Box>
      )
    }

    return (
      <Box>
        <Button key="enhance" label="Enhance" onPress={() => enhance($)} />
        <Text dimColor> rewrites your draft using CLAUDE.md and skills</Text>
      </Box>
    )
  })
}
