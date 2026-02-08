# Pasfini

## PWA Support

Pasfini is a Progressive Web App (PWA) that can be installed on your device and works offline.

### Features
- **Installable**: Can be installed as a standalone app on mobile and desktop devices
- **Offline Support**: Service worker caches resources for offline functionality
- **App Icons**: Custom icons for various screen sizes and platforms
- **Native Feel**: Runs in standalone mode without browser UI

### Installation
1. Visit https://cmaneu.github.io/Pasfini/ on your device
2. Look for the "Install" or "Add to Home Screen" prompt
3. Follow the prompts to install the app

## Deployment

This project is automatically deployed to GitHub Pages when changes are pushed to the `main` branch.

The deployment workflow:
1. Builds the project using `npm run build`
2. Deploys the `dist/` folder to GitHub Pages
3. Available at: https://cmaneu.github.io/Pasfini/

### Manual Deployment

You can also trigger a deployment manually from the [Actions tab](../../actions/workflows/deploy.yml) using the "Run workflow" button.
