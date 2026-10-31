# Private app on GitHub Pages with Google sign-in

A static web app hosted on GitHub Pages, protected by Google sign-in through Firebase Authentication.

## Important: how security works here

GitHub Pages only serves static files, so **the HTML/JS files themselves are public**. Nobody can truly hide static files behind a login on Pages. What *is* protected is your **data**: it lives in Firestore, and `firestore.rules` only allows your verified Google account to read or write it. Anyone who visits the site without being on the allowlist sees a login screen and can't get any data.

Don't put secrets or private content directly in the HTML/JS. Put it in Firestore (or another backend that checks the login token).

If you need the page source itself to be private, use a private-by-default host instead (Cloudflare Access, Firebase Hosting with a server check, or GitHub Pages on a private repo with a GitHub Enterprise plan).

## Setup (about 10 minutes)

### 1. Create the Firebase project
1. Go to https://console.firebase.google.com and click **Add project**.
2. **Build > Authentication > Get started > Sign-in method > Google > Enable**. Choose a support email and save.
3. **Build > Firestore Database > Create database** (production mode, any region).
4. **Project settings (gear) > Your apps > Web (`</>`)**: register an app and copy the `firebaseConfig` values.

### 2. Configure the app
1. Paste the config values into `firebase-config.js`.
2. Put your Google email in `allowedEmails` in `firebase-config.js`.
3. In the Firebase console, open **Firestore > Rules**, paste the contents of `firestore.rules`, and **Publish**.

### 3. Deploy to GitHub Pages
1. Create a new GitHub repo and push these files to it (`index.html`, `app.js`, `firebase-config.js`, `firestore.rules`, `README.md`):
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo: **Settings > Pages > Source: Deploy from a branch > main / (root)** and save.
3. Your site will be at `https://<you>.github.io/<repo>/`.

### 4. Authorize your domain (required, or login will fail)
In Firebase: **Authentication > Settings > Authorized domains > Add domain**, then add `<you>.github.io`.

## Using it
Open your Pages URL and click **Sign in with Google**. Login persists in your browser, so next visits sign you in automatically.

## Customizing
The sample app is a simple notes list stored at `users/{uid}/notes`. Replace the logic in `app.js` and the markup in `index.html` with your own app. Keep your data under `users/{uid}/...` so the existing rules protect it.

## Adding more users
Add their email to both `allowedEmails` in `firebase-config.js` and the list in `firestore.rules`, then republish the rules.
