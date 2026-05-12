# Vilo Marketplace

מרקטפלייס ספקים של Vilo HR Technologies — פלטפורמת AI לחווית עובד. מאפשר למנהלי HR לגלות ולסנן מאות שירותים מ-18 ספקים בקטגוריות כמו וולנס, גיבוש, למידה, אוכל ועוד. כולל קונסיירז' AI חכם שעוזר למצוא את הפעילות המושלמת.

## Setup

1. התקנת תלויות:
   ```bash
   npm install
   ```

2. הגדרת משתני סביבה:
   ```bash
   cp .env.local.example .env.local
   ```
   ערכו את `.env.local` ומלאו את הערכים עבור Supabase ו-Anthropic.

3. הרצת מיגרציה ב-Supabase:
   העתיקו את התוכן של `supabase/migrations/001_schema.sql` ל-SQL Editor של Supabase והריצו.

4. טעינת נתונים:
   ```bash
   npm run seed
   ```

5. הפעלת שרת פיתוח:
   ```bash
   npm run dev
   ```
   פתחו את http://localhost:3000

## Deploy to Vercel

1. חברו את ה-repo ל-Vercel
2. הגדירו את משתני הסביבה (Environment Variables) ב-Vercel dashboard
3. Vercel יבצע build ו-deploy אוטומטית

## עדכון נתוני ספקים

ערכו את `data/suppliers_data.json` והריצו מחדש:
```bash
npm run seed
```
