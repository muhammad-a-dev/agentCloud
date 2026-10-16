import type { PreloadBridge } from '@shared/api'

declare global {
  interface Window {
    agentCloud: PreloadBridge
  }
}

export const api: PreloadBridge = window.agentCloud
