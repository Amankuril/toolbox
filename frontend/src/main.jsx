import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import { applyCachedTheme } from './core/theme/theme'
import './styles/index.css'

// Paint with the admin's last-known colours before the settings request returns.
applyCachedTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
