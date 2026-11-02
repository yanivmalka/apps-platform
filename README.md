# apps-platform

שרת משותף לכל האפליקציות: פרויקט Firebase אחד, משתמשים ומנהלים משותפים, ומערכת הקדשות וחסויות שכל אפליקציה יכולה להשתמש בה. ספירת העומר היא האפליקציה הראשונה.

| תיקייה | מה יש בה |
|---|---|
| `firestore.rules` | חוקי האבטחה של המאגר: מי קורא ומי כותב |
| `sdk/` | ספריית החיבור (`window.AppsPlatform`). `npm run build` יוצר את `sdk/dist/` |
| `sites/sponsors/` | אתר ההזמנות והניהול: הזמנת הקדשה, ההזמנות שלי, ניהול וסימולציית רווח |
| `tests/` | בדיקות לחוקי האבטחה, רצות ב־GitHub Actions |
| `ARCHITECTURE.md` | מבנה הנתונים, הזרימה ואיך מוסיפים אפליקציה |

## הקמה ראשונה (פעם אחת)

1. **פרויקט Firebase** בשם `malka-apps` (אם השם תפוס, לעדכן את `.firebaserc`).
   - Firestore: אזור `me-west1`, מצב Production.
   - Authentication: להפעיל Google ו־Anonymous.
   - Authentication ← Settings ← Authorized domains: להוסיף `yanivmalka.github.io`.
2. **הגדרות ווב**: Project settings ← Your apps ← Web. להעתיק את `firebaseConfig` ל־`sites/sponsors/config.js`, ולקובץ `src/platform-config.js` באפליקציית העומר.
3. **פריסה אוטומטית**: חשבון שירות ייעודי `github-deploy@malka-apps.iam.gserviceaccount.com` עם התפקיד Firebase Admin (Google Cloud ← IAM ← Service accounts), ומפתח JSON שלו. את תוכן הקובץ שומרים ב־GitHub כ־secret בשם `FIREBASE_SERVICE_ACCOUNT` (Settings ← Secrets and variables ← Actions). מכאן כל push ל־main פורס את החוקים ל־Firebase. האתר עצמו מתפרסם ב־GitHub Pages: https://yanivmalka.github.io/apps-platform/
4. **הפיכה למנהל**: נכנסים לאתר, מתחברים עם Google, ובלשונית "ההזמנות שלי" מעתיקים את מזהה החשבון. ב־Firestore יוצרים מסמך `admins/<המזהה>` עם שדה `apps` מסוג array שמכיל את `*`.
5. **באתר, בלשונית ניהול**: "טען חבילות מומלצות" (גם שומר את הגדרות המלאי), ואחר כך "שמירה" בהגדרות.

## עבודה מקומית

```bash
npm install
npm run build        # בונה את ה־SDK ומעתיק לאתר
npm run serve        # http://localhost:8090/sites/sponsors/?backend=memory
```
`?backend=memory` מריץ הכול מול מאגר בדפדפן, בלי Firebase. `&as=u-admin` מתחבר כמנהל, ו־`&as=c1` כלקוח.
