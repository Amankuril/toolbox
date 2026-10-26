import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import { dropServerHead } from './core/seo/serverHead'
import { applyCachedTheme } from './core/theme/theme'
import './styles/index.css'

// Paint with the admin's last-known colours before the settings request returns.
applyCachedTheme()
// Pages render their own title and description; the server's copies would otherwise stay first in <head>.
dropServerHead('title[data-ssr], meta[name="description"][data-ssr]')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
