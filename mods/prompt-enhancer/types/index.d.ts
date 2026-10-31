export type EnhanceStatus = 'idle' | 'working' | 'ready'

declare module 'claude-code' {
  interface PluginState {
    'prompt-enhancer': {
      status: EnhanceStatus
      original: string
      enhanced: string
    }
  }
}
