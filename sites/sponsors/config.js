// Public Firebase web config of the shared project (not a secret: access is enforced by firestore.rules).
// Paste the firebaseConfig block from Firebase console → Project settings → Your apps → Web app.
// ?backend=memory runs the site on the local test backend instead (data stays in this browser).
window.PLATFORM_CONFIG = {
  appId: 'omer',
  // where "how it looks in the app" links open (dedication preview)
  appUrl: 'https://yanivmalka.github.io/omer-app/',
  firebase: {
    apiKey: 'AIzaSyAVyw2RUh3T0UPaxbCluCgFKzkLaGZOIyQ',
    authDomain: 'malka-apps.firebaseapp.com',
    projectId: 'malka-apps',
    storageBucket: 'malka-apps.firebasestorage.app',
    messagingSenderId: '141711225817',
    appId: '1:141711225817:web:30ceb430dee31b59ebdfc8',
  },
};
