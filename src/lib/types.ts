export type NotePermission = 'VIEW' | 'EDIT'

export type UserRole = 'DONO' | 'GERENTE' | 'COORDENADOR' | 'FUNCIONARIO' | 'GUEST'
export type NotePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface Profile {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  role: UserRole
  created_at: string
  updated_at: string
}

export interface NoteCategory {
  id: string
  name: string
  color: string
  icon: string | null
  user_id: string
  position: number
  created_at: string
  updated_at: string
}

export interface Note {
  id: string
  title: string
  content: string
  priority: NotePriority
  category_id: string | null
  client_id: string | null
  task_id: string | null
  creator_id: string
  is_pinned: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
  // Relações opcionais (joins)
  creator?: Profile
  collaborators?: NoteCollaborator[]
}

export interface NoteCollaborator {
  id: string
  note_id: string
  user_id: string
  permission: NotePermission
  added_by: string
  created_at: string
  // Relações opcionais (joins)
  profile?: Profile
}

export interface NoteClientAnnotation {
  id: string
  note_id: string
  client_id: string
  excerpt: string
  selection_start: number
  selection_end: number
  created_by: string
  created_at: string
}

// Tipos do Mileto Ops (somente leitura)
export interface Client {
  id: string
  name: string
  situation_trafego: string | null
  situation_vendas: string | null
  assigned_to: string | null
  created_at: string
}

export interface Task {
  id: string
  title: string
  status: string
  priority: NotePriority | null
  assignee_id: string | null
  client_id: string | null
  due_date: string | null
  created_at: string
}
