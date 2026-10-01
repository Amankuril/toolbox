import { createContext, useContext } from 'react'

/** Which module (user / vendor / admin) the current screen belongs to. Set by ModuleRoot. */
export const ModuleContext = createContext('user')
export const useModule = () => useContext(ModuleContext)
