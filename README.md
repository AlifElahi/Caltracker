# Caltracker

Private calorie calendar app with login, manual food entries, walking/workout burn, weight logging, session reports, backups, and optional MongoDB storage.

## Run locally

```bash
npm run dev
```

Open `http://127.0.0.1:5173`.

Without `MONGODB_URI`, the app uses local JSON files under `data/`. This is fine for local development.

## Free MongoDB Atlas storage

Create a MongoDB Atlas Free cluster, then add these environment variables:

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=caltracker
MONGODB_COLLECTION=app_state
```

Only `MONGODB_URI` is required. The other two have the defaults shown above.

When MongoDB is enabled, the app stores:

- calorie and weight data
- maintenance and goal settings
- the owner login password hash
- active sessions

## Render

Use:

- Build command: `npm install`
- Start command: `npm start`

Add `MONGODB_URI` in Render's Environment settings. Do not commit the connection string to Git.

Render free instances can spin down or restart, so local JSON files are not a safe place for live hosted data. With MongoDB Atlas configured, the app data lives in Atlas and survives Render spin-downs, restarts, and redeploys.

If you already have data in the app, download a backup first, deploy with `MONGODB_URI`, then use Restore data in the sidebar to import it into MongoDB.
