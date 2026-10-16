import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import { Celebration, FullAccessBadge, OfflineBanner, PanelBoundary, StopAllButton, Toasts, WindowControls } from '@/components/Chrome'
import { Sidebar } from '@/components/Sidebar'
import { IconButton } from '@/components/ui'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { TaskDrawer } from '@/components/TaskDrawer'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { Chat, ChatHeaderPill } from './Chat'
import { Onboarding } from './Onboarding'
import { ReconnectModal, SearchPalette, Tour, WorkspaceMissing } from './Overlays'
import { SettingsPage } from './Settings'
import { TasksPage } from './Tasks'
import { TeamPage } from './Team'
import { WorkflowsPage } from './Workflows'
import { SchedulePage } from './Schedule'

const TITLES = { tasks: 'Tasks', team: 'Team', settings: 'Settings', workflows: 'Design Workflow', schedule: 'Schedule' } as const

export default function App() {
  const ready = useApp((s) => s.ready)
  const onboarded = useApp((s) => s.settings?.onboarded)
  const route = useApp((s) => s.route)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const toggleSidebar = useApp((s) => s.toggleSidebar)

  useEffect(() => {
    const off = api.onEvent((e) => useApp.getState().handleEvent(e))
    void useApp.getState().init()
    return off
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const st = useApp.getState()
      if (!st.settings?.onboarded) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'n' && !e.shiftKey) { e.preventDefault(); void st.newChat() }
      else if (k === 'k') { e.preventDefault(); st.setSearch(true) }
      else if (k === 't') { e.preventDefault(); st.setRoute('tasks') }
      else if (k === ',') { e.preventDefault(); st.openSettings() }
      else if (k === 'b') { e.preventDefault(); st.toggleSidebar() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (!ready) {
    return (
      <div className="h-full flex">
        <div className="w-[315px] bg-sidebar border-r border-divider p-4 space-y-3 pt-24">
          <div className="skeleton w-16 h-16 rounded-full mx-auto" />
          <div className="skeleton h-14" />
          <div className="skeleton h-14" />
        </div>
        <div className="flex-1 drag" />
      </div>
    )
  }

  if (!onboarded) {
    return (
      <PanelBoundary name="onboarding">
        <Onboarding />
        <Toasts />
      </PanelBoundary>
    )
  }

  return (
    <div className="h-full flex bg-bg">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.div
            key="sidebar"
            className="h-full overflow-hidden shrink-0"
            initial={{ width: 0 }}
            animate={{ width: 315 }}
            exit={{ width: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <PanelBoundary name="sidebar">
              <Sidebar />
            </PanelBoundary>
          </motion.div>
        )}
      </AnimatePresence>
      <main className="flex-1 min-w-0 flex flex-col h-full">
        <header className="drag h-[72px] shrink-0 grid grid-cols-[1fr_auto_1fr] items-center pl-4 pr-2">
          <div className="flex items-center">
            <IconButton
              label={sidebarOpen ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
              onClick={() => toggleSidebar()}
              className="no-drag w-[38px] h-[38px]"
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </IconButton>
          </div>
          <div className="flex justify-center">
            {route === 'chat' ? (
              <PanelBoundary name="header"><ChatHeaderPill /></PanelBoundary>
            ) : (
              <div className="h-[46px] px-5 rounded-full bg-sidebar border border-line flex items-center font-semibold text-[15px]">{TITLES[route]}</div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 self-start pt-[14px]">
            <StopAllButton />
            <FullAccessBadge />
            <WindowControls />
          </div>
        </header>
        <OfflineBanner />
        <WorkspaceMissing />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route}
            className="flex-1 min-h-0 flex flex-col"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <PanelBoundary name={route}>
              {route === 'chat' ? <Chat /> : route === 'tasks' ? <TasksPage /> : route === 'team' ? <TeamPage /> : route === 'workflows' ? <WorkflowsPage /> : route === 'schedule' ? <SchedulePage /> : <SettingsPage />}
            </PanelBoundary>
          </motion.div>
        </AnimatePresence>
      </main>
      <PanelBoundary name="drawer"><TaskDrawer /></PanelBoundary>
      <SearchPalette />
      <ReconnectModal />
      <Tour />
      <Toasts />
      <Celebration />
    </div>
  )
}
