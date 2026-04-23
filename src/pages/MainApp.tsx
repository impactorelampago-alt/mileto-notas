import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth-store'
import { useNotesStore } from '../stores/notes-store'
import { useCategoriesStore } from '../stores/categories-store'
import { useUIStore } from '../stores/ui-store'
import { useOpsStore } from '../stores/ops-store'
import Titlebar from '../components/layout/Titlebar'
import MenuBar from '../components/layout/MenuBar'
import TabBar from '../components/layout/TabBar'
import StatusBar from '../components/layout/StatusBar'
import Editor from '../components/editor/Editor'
import SearchBar from '../components/editor/SearchBar'
import CategoryModal from '../components/ui/CategoryModal'
import AssignCategoryModal from '../components/ui/AssignCategoryModal'
import CollaboratorsModal from '../components/ui/CollaboratorsModal'
import SharedNotesModal from '../components/ui/SharedNotesModal'
import DeleteNoteModal from '../components/ui/DeleteNoteModal'
import DeleteSectionModal from '../components/ui/DeleteSectionModal'
import ConnectModal from '../components/ui/ConnectModal'
import QuickSearch from '../components/ui/QuickSearch'

export default function MainApp() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const loadNotes = useNotesStore((s) => s.loadNotes)
  const updateNote = useNotesStore((s) => s.updateNote)
  const activeTabId = useNotesStore((s) => s.activeTabId)
  const subscribeToNote = useNotesStore((s) => s.subscribeToNote)
  const unsubscribeFromNote = useNotesStore((s) => s.unsubscribeFromNote)
  const fetchNoteById = useNotesStore((s) => s.fetchNoteById)
  const openTab = useNotesStore((s) => s.openTab)
  const loadNotesWithCollaborators = useNotesStore((s) => s.loadNotesWithCollaborators)
  const deleteNote = useNotesStore((s) => s.deleteNote)
  const closeTab = useNotesStore((s) => s.closeTab)
  const notes = useNotesStore((s) => s.notes)
  const loadCategories = useCategoriesStore((s) => s.loadCategories)
  const createCategory = useCategoriesStore((s) => s.createCategory)
  const {
    searchBarVisible, setSearchBarVisible,
    showCategoryModal, setShowCategoryModal,
    assignCategoryNoteId, setAssignCategoryNoteId,
    editingCategoryId, setEditingCategoryId,
    showCollaboratorsModal, setShowCollaboratorsModal,
    showSharedNotesModal, setShowSharedNotesModal,
    showDeleteNoteModal, setShowDeleteNoteModal,
    deleteSectionKeySuffix, setDeleteSectionKeySuffix,
    showConnectModal, setShowConnectModal,
    showQuickSearch, setShowQuickSearch,
  } = useUIStore()
  const updateCategory = useCategoriesStore((s) => s.updateCategory)
  const editingCategory = useCategoriesStore((s) =>
    s.categories.find((c) => c.id === editingCategoryId) ?? null
  )

  const sections = useOpsStore((s) => s.sections)
  const setActiveSectionId = useOpsStore((s) => s.setActiveSectionId)
  const setActiveTab = useNotesStore((s) => s.setActiveTab)
  const hasLoadedOnce = useNotesStore((s) => s.hasLoadedOnce)
  const createNote = useNotesStore((s) => s.createNote)
  const { loadOpsData, subscribeToOpsChanges, unsubscribeFromOpsChanges, setupAutoReconciliation } = useOpsStore()

  const [hasInitialized, setHasInitialized] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return
    void loadNotes()
    void loadCategories()
    void loadNotesWithCollaborators()

  }, [isAuthenticated, loadNotes, loadCategories, loadNotesWithCollaborators])

  // Ops sync: load data + Realtime subscription + auto-reconciliation on focus
  useEffect(() => {
    if (!isAuthenticated) return

    void loadOpsData()
    subscribeToOpsChanges()
    const cleanupReconciliation = setupAutoReconciliation()

    return () => {
      unsubscribeFromOpsChanges()
      cleanupReconciliation()
    }
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persiste a última nota aberta no electron-store
  useEffect(() => {
    if (!activeTabId) return
    void window.electronAPI?.sessionStorage?.set('lastNoteId', activeTabId)
  }, [activeTabId])

  // Inicialização: restaura última nota (usuário recorrente) ou cria nota (novo usuário)
  useEffect(() => {
    if (hasInitialized || !isAuthenticated || !hasLoadedOnce || sections.length === 0) return
    setHasInitialized(true)

    void (async () => {
      const { openTabs } = useNotesStore.getState()
      if (openTabs.length > 0) return // já tem abas abertas

      const lastNoteId = await window.electronAPI?.sessionStorage?.get('lastNoteId')
      const { notes: currentNotes } = useNotesStore.getState()

      if (lastNoteId) {
        const note = currentNotes.find((n) => n.id === lastNoteId)
        if (note) {
          openTab(note.id)
          setActiveTab(note.id)
          // Navegar para a categoria certa
          if (note.task_id) {
            const { tasks } = useOpsStore.getState()
            const task = tasks.find((t) => t.id === note.task_id)
            if (task) {
              const section = sections.find((s) => task.status.endsWith(s.key_suffix))
              if (section) setActiveSectionId(section.key_suffix)
            }
          }
          return
        }
      }

      // Novo usuário ou nota deletada — abre primeira seção e cria nota "Sem título"
      const firstSection = sections[0]
      if (!firstSection) return
      setActiveSectionId(firstSection.key_suffix)
      const newNote = await createNote({ title: 'Sem título', sectionSuffix: firstSection.key_suffix })
      if (newNote) {
        openTab(newNote.id)
        setActiveTab(newNote.id)
      }
    })()
  }, [hasInitialized, isAuthenticated, hasLoadedOnce, sections, openTab, setActiveTab, setActiveSectionId, createNote])

  // Salvar todas as notas abertas antes de fechar o app
  useEffect(() => {
    if (!window.electronAPI?.onBeforeClose) return

    window.electronAPI.onBeforeClose(async () => {
      const { notes: storeNotes, openTabs } = useNotesStore.getState()

      const saves = openTabs.map((tabId) => {
        const note = storeNotes.find((n) => n.id === tabId)
        if (!note) return Promise.resolve()
        return useNotesStore.getState().updateNote(note.id, {
          content: note.content,
          title: note.title,
        })
      })

      await Promise.all(saves)
      window.electronAPI.closeApp()
    })
  }, [])

  useEffect(() => {
    if (activeTabId) {
      subscribeToNote(activeTabId)
    } else {
      unsubscribeFromNote()
    }
    return () => {
      unsubscribeFromNote()
    }
  }, [activeTabId, subscribeToNote, unsubscribeFromNote])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        setShowQuickSearch(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setShowQuickSearch])

  if (!isAuthenticated) return null

  const handleCategoryConfirm = (name: string, color: string) => {
    setShowCategoryModal(false)
    void createCategory(name, color)
  }

  const handleAssignCategory = (categoryId: string | null) => {
    if (assignCategoryNoteId) {
      void updateNote(assignCategoryNoteId, { category_id: categoryId })
    }
    setAssignCategoryNoteId(null)
  }

  const handleEditCategory = (name: string, color: string) => {
    if (editingCategoryId) {
      void updateCategory(editingCategoryId, { name, color })
    }
    setEditingCategoryId(null)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Titlebar />
      <MenuBar />
      <TabBar />
      <SearchBar
        visible={searchBarVisible}
        onClose={() => setSearchBarVisible(false)}
      />
      <Editor />
      <StatusBar />

      <CategoryModal
        visible={showCategoryModal}
        onConfirm={handleCategoryConfirm}
        onCancel={() => setShowCategoryModal(false)}
      />

      <AssignCategoryModal
        visible={assignCategoryNoteId !== null}
        onSelect={handleAssignCategory}
        onCancel={() => setAssignCategoryNoteId(null)}
      />

      <CategoryModal
        visible={editingCategoryId !== null}
        mode="edit"
        initialName={editingCategory?.name ?? ''}
        initialColor={editingCategory?.color ?? '#10b981'}
        onConfirm={handleEditCategory}
        onCancel={() => setEditingCategoryId(null)}
      />

      {showSharedNotesModal && (
        <SharedNotesModal
          onClose={() => setShowSharedNotesModal(false)}
          onOpenNote={async (noteId) => {
            await fetchNoteById(noteId)
            openTab(noteId)
            setShowSharedNotesModal(false)
          }}
        />
      )}

      {showDeleteNoteModal && activeTabId && (
        <DeleteNoteModal
          onClose={() => setShowDeleteNoteModal(false)}
          onConfirm={() => {
            const noteId = activeTabId
            setShowDeleteNoteModal(false)
            closeTab(noteId)
            void deleteNote(noteId)
          }}
        />
      )}

      {deleteSectionKeySuffix && (
        <DeleteSectionModal
          keySuffix={deleteSectionKeySuffix}
          onClose={() => setDeleteSectionKeySuffix(null)}
        />
      )}

      {showConnectModal && activeTabId && (
        <ConnectModal
          key={activeTabId}
          noteId={activeTabId}
          currentClientId={notes.find((n) => n.id === activeTabId)?.client_id ?? null}
          currentTaskId={notes.find((n) => n.id === activeTabId)?.task_id ?? null}
          onClose={() => setShowConnectModal(false)}
        />
      )}

      {showCollaboratorsModal && activeTabId && (
        <CollaboratorsModal
          noteId={activeTabId}
          onClose={() => setShowCollaboratorsModal(false)}
        />
      )}

      {showQuickSearch && <QuickSearch />}
    </div>
  )
}
