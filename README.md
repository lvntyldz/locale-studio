# Locale Studio

Locale Studio is a simple, browser-based JSON translation editor for web projects. It helps you manage your translation files easily.

## Features

- **In-Context Editing (Alt+Click)**: You can press `Alt` and click on any text in your web app. It will automatically open the editor for that exact text.
- **Invisible Tags**: We use zero-width characters (invisible text) to track translations. This means it will never break your HTML tags or React Virtual DOM.
- **React Support**: It includes a simple `useI18nInspector` hook for fast setup.
- **Namespaces**: Works perfectly with nested folders (like `locales/en/common.json`).
- **Local Files**: No database and no cloud. It saves directly to your local JSON files.

## Installation

```bash
yarn add -D locale-studio
# or
npm install -D locale-studio
```

## How to use in React

**1. Setup your i18n config:**
```javascript
import { devtoolsPostProcessor } from 'locale-studio/client';
import i18n from 'i18next';

// Only use the post processor in development mode!
if (process.env.NODE_ENV === 'development') {
  i18n.use(devtoolsPostProcessor);
}
```

**2. Add the React hook to your App:**
```javascript
import { useI18nInspector } from 'locale-studio/react';

function App() {
  // This hook listens for Alt+Click events
  useI18nInspector(); 
  
  return <div>Your Application</div>;
}
```

**3. Run the studio:**
Open your terminal and start Locale Studio:
```bash
npx locale-studio --dir public/locales --scan src --port 3737
```

That's it! Now, when you look at your app in the browser, you can **Alt+Click** on any text to edit the translation immediately.
