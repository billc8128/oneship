import { createContext, useContext, useReducer, useEffect, type Dispatch } from 'react'
import React from 'react'

export interface Project {
  id: string
  name: string
  status: 'active' | 'planning' | 'done'
  path: string | null
  createdAt: number
}

type ProjectAction =
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'DELETE_PROJECT'; payload: string }
  | { type: 'UPDATE_PROJECT'; payload: { id: string } & Partial<Project> }

function projectReducer(state: Project[], action: ProjectAction): Project[] {
  switch (action.type) {
    case 'SET_PROJECTS':
      return action.payload
    case 'ADD_PROJECT':
      return [...state, action.payload]
    case 'DELETE_PROJECT':
      return state.filter((p) => p.id !== action.payload)
    case 'UPDATE_PROJECT': {
      const { id, ...updates } = action.payload
      return state.map((p) => (p.id === id ? { ...p, ...updates } : p))
    }
    default:
      return state
  }
}

interface ProjectContextValue {
  projects: Project[]
  dispatch: Dispatch<ProjectAction>
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, rawDispatch] = useReducer(projectReducer, [])

  // Load projects from disk on mount
  useEffect(() => {
    window.electronAPI.store.getProjects().then((stored) => {
      rawDispatch({ type: 'SET_PROJECTS', payload: stored })
    })
  }, [])

  // Wrapper dispatch that also persists changes via IPC
  const dispatch: Dispatch<ProjectAction> = (action) => {
    rawDispatch(action)
    switch (action.type) {
      case 'ADD_PROJECT':
        window.electronAPI.store.addProject(action.payload)
        break
      case 'DELETE_PROJECT':
        window.electronAPI.store.deleteProject(action.payload)
        break
      case 'UPDATE_PROJECT': {
        const { id, ...updates } = action.payload
        window.electronAPI.store.updateProject(id, updates)
        break
      }
    }
  }

  return React.createElement(
    ProjectContext.Provider,
    { value: { projects, dispatch } },
    children
  )
}

export function useProjects() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProjects must be used within a ProjectProvider')
  return ctx
}
