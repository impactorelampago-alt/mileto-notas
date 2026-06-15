import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth-store'
import { useNotesStore } from '../stores/notes-store'
import { useCategoriesStore } from '../stores/categories-store'
import { useUIStore } from '../stores/ui-store'
import { useOpsStore } from '../stores/ops-store'
import Titlebar from '../components/layout/Titlebar'
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
import SharePickerModal from '../components/ui/SharePickerModal'
import { useSharingStore } from '../stores/sharing-store'
import { useNotificationsStore } from '../stores/notifications-store'
import { loadDrafts, removeDraft, loadSession, saveSession } from '../lib/local-drafts'
import { DEFAULT_SECTION_SUFFIX } from '../lib/sections'
import { isStatusSuffix } from '../lib/status-keys'

export default function MainApp() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const loadNotes = useNotesStore((s) => s.loadNotes)
  const updateNote = useNotesStore((s) => s.updateNote)
  const activeTabId = useNotesStore((s) => s.activeTabId)
  const openTabs = useNotesStore((s) => s.openTabs)
  const subscribeToNote = useNotesStore((s) => s.subscribeToNote)
  const unsubscribeFromNote = useNotesStore((s) => s.unsubscribeFromNote)
  const fetchNoteById = useNotesStore((s) => s.fetchNoteById)
  const openTab = useNotesStore((s) => s.openTab)
  const loadNotesWithCollaborators = useNotesStore((s) => s.loadNotesWithCollaborators)
  const deleteNote = useNotesStore((s) => s.deleteNote)
  const closeTab = useNotesStore((s) => s.closeTab)
  const notes = useNotesStore((s) => s.notes)
  const loadCategories = useCategoriesStore((s) => s.loadCategories)
  const loadTeamProfiles = useAuthStore((s) => s.loadTeamProfiles)
  const loadShares = useSharingStore((s) => s.loadShares)
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
    sharePickerTarget, setSharePickerTarget,
  } = useUIStore()
  const updateCategory = useCategoriesStore((s) => s.updateCategory)
  const editingCategory = useCategoriesStore((s) =>
    s.categories.find((c) => c.id === editingCategoryId) ?? null
  )

  const sections = useOpsStore((s) => s.sections)
  const activeSectionId = useOpsStore((s) => s.activeSectionId)
  const setActiveSectionId = useOpsStore((s) => s.setActiveSectionId)
  const setActiveTab = useNotesStore((s) => s.setActiveTab)
  const hasLoadedOnce = useNotesStore((s) => s.hasLoadedOnce)
  const createNote = useNotesStore((s) => s.createNote)
  const { loadOpsData, subscribeToOpsChanges, unsubscribeFromOpsChanges, setupAutoReconciliation } = useOpsStore()

  const [hasInitialized, setHasInitialized] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return
    void loadCategories()
    void loadNotesWithCollaborators()
    void loadTeamProfiles()
    // Os mapas de "compartilhado-comigo" precisam estar prontos ANTES de
    // notes-store/ops-store montarem as notas e seções compartilhadas. Encadeia:
    // carrega shares → recarrega notas + reagenda o refresh do Ops.
    void (async () => {
      await loadShares()
      void loadNotes()
      useOpsStore.getState().scheduleOpsRefresh('shares-loaded')
    })()

  }, [isAuthenticated, loadNotes, loadCategories, loadNotesWithCollaborators, loadTeamProfiles, loadShares])

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

  // Sino de notificações (tarefa concluída): carrega + assina o Realtime.
  // Sempre do usuário REAL logado — limpa ao deslogar/trocar de sessão.
  useEffect(() => {
    if (!isAuthenticated) return
    const notif = useNotificationsStore.getState()
    void notif.loadNotifications()
    notif.subscribe()
    return () => {
      const n = useNotificationsStore.getState()
      n.unsubscribe()
      n.clear()
    }
  }, [isAuthenticated])

  // Persiste a sessão (abas abertas + aba ativa) localmente, para restauração
  // silenciosa estilo Bloco de Notas do Windows 11. Só grava depois do restore
  // inicial, para não sobrescrever a sessão salva antes de restaurá-la.
  useEffect(() => {
    if (!hasInitialized) return
    void saveSession({ openTabs, activeTabId, activeSectionId })
  }, [openTabs, activeTabId, activeSectionId, hasInitialized])

  // Garante que SEMPRE haja uma categoria selecionada: a última usada (sessão)
  // ou, na ausência dela, a padrão "Lembrete" (TODO). Roda quando as seções
  // carregam ou quando a categoria ativa fica inválida (troca de conta, exclusão).
  useEffect(() => {
    if (!isAuthenticated || sections.length === 0) return
    if (activeSectionId && sections.some((s) => s.key_suffix === activeSectionId)) return
    let cancelled = false
    void (async () => {
      const session = await loadSession()
      if (cancelled) return
      const target =
        session?.activeSectionId && sections.some((s) => s.key_suffix === session.activeSectionId)
          ? session.activeSectionId
          : (sections.find((s) => s.key_suffix === DEFAULT_SECTION_SUFFIX)?.key_suffix
              ?? sections[0]?.key_suffix
              ?? null)
      if (target && !cancelled) setActiveSectionId(target)
    })()
    return () => { cancelled = true }
  }, [isAuthenticated, sections, activeSectionId, setActiveSectionId])

  // Abertura inicial (depois que a categoria já foi garantida pelo efeito acima):
  // abre a última nota criada daquela categoria ou, se não houver, cria uma nova.
  useEffect(() => {
    if (hasInitialized || !isAuthenticated || !hasLoadedOnce || !activeSectionId) return

    setHasInitialized(true)

    void (async () => {
      if (useNotesStore.getState().activeTabId) return

      // 0. Restaura rascunhos locais não-sincronizados. O conteúdo local desta
      //    máquina é o mais recente do usuário — semeia na memória e ressincroniza
      //    para a nuvem em background. Rascunhos idênticos à nuvem são descartados.
      try {
        const drafts = await loadDrafts()
        for (const [id, draft] of Object.entries(drafts)) {
          const note = useNotesStore.getState().notes.find((n) => n.id === id)
          if (!note) continue
          if (draft.content !== note.content || draft.title !== note.title) {
            useNotesStore.setState((s) => ({
              notes: s.notes.map((n) =>
                n.id === id ? { ...n, content: draft.content, title: draft.title } : n,
              ),
            }))
            void useNotesStore.getState().updateNote(id, { content: draft.content, title: draft.title })
          } else {
            void removeDraft(id)
          }
        }
      } catch (err) {
        console.error('[restore] Falha ao restaurar rascunhos locais:', err)
      }

      const sectionsNow = useOpsStore.getState().sections
      const session = await loadSession()

      // A categoria já está garantida (efeito acima); abre a nota dela.
      const targetSection = activeSectionId

      const latestNotes = useNotesStore.getState().notes
      const tasksNow = useOpsStore.getState().tasks
      const suffixOfNote = (taskId: string | null): string | null => {
        if (!taskId) return null
        const task = tasksNow.find((t) => t.id === taskId)
        if (!task) return null
        return sectionsNow.find((s) => isStatusSuffix(task.status, s.key_suffix))?.key_suffix ?? null
      }
      const notesInSection = latestNotes.filter((n) => suffixOfNote(n.task_id) === targetSection)

      // 2a. Nota ativa: a da sessão anterior (se ainda nessa categoria) → senão a última criada.
      let activeId: string | null = null
      if (session?.activeTabId && notesInSection.some((n) => n.id === session.activeTabId)) {
        activeId = session.activeTabId
      } else if (notesInSection.length > 0) {
        activeId = [...notesInSection].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0].id
      }

      if (activeId) {
        openTab(activeId)
        setActiveTab(activeId)
        return
      }

      // 3. Categoria sem notas → cria uma nova vazia (estilo Bloco de Notas).
      if (!targetSection) return
      const newNote = await createNote({ title: 'Sem título', sectionSuffix: targetSection })
      if (newNote) {
        openTab(newNote.id)
        setActiveTab(newNote.id)
      }
    })()
  }, [hasInitialized, isAuthenticated, hasLoadedOnce, activeSectionId, openTab, setActiveTab, createNote])

  // (Fechar + salvar antes de fechar agora é gerenciado por um handler único em App.tsx)

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

  // Sincroniza rascunhos locais pendentes (edições feitas offline) assim que a
  // conexão voltar (evento `online`) ou ao focar a janela — sobem pra nuvem sem
  // precisar reabrir o app.
  useEffect(() => {
    if (!isAuthenticated) return
    void useOpsStore.getState().loadClients()
    const flush = () => { void useNotesStore.getState().flushPendingDrafts() }
    const onVisible = () => { if (document.visibilityState === 'visible') flush() }
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isAuthenticated])

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

      {sharePickerTarget && (
        <SharePickerModal
          kind={sharePickerTarget.kind}
          id={sharePickerTarget.id}
          label={sharePickerTarget.label}
          onClose={() => setSharePickerTarget(null)}
        />
      )}
    </div>
  )
}
