# Strapi with Cloudflare R2 Media Storage and Backup

This example deploys self-hosted version of [Strapi](https://strapi.io/). Internally it uses a PostgreSQL database to store the data and Cloudflare R2 for media storage. Includes a weekly database backup to Cloudflare R2 as well ([source here](https://github.com/sungkhum/postgres-r2-backups)).

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/strapi-with-cloudflare-r2?referralCode=6EnXto&utm_medium=integration&utm_source=template&utm_campaign=generic)

## ✨ Features

- Strapi
- Postgres

## 💁‍♀️ How to use

- Click the Railway button 👆
- Add the environment variables
- Media will automatically be persisted between deploys!

## 💻 Developing locally

When developing locally this Strapi template will connect to the Postgres server from its public [TCP Proxy](https://docs.railway.app/deploy/exposing-your-app#tcp-proxying)

- Enable the feature flag `Template Service Eject` in the [Feature Flags](https://railway.app/account/feature-flags) menu
- Within the service settings of the Strapi service click the `Eject` button on the upstream repository
- Clone that newly created repository locally
- Install Strapi's dependencies with `yarn install` or `npm install`
- Install the Railway CLI
    - Instructions for that can be found [here](https://docs.railway.app/develop/cli#installation)
    - If this is your first time using the CLI make sure to login with `railway login`
- Within the local repository run `railway link` to link the local repository to the Strapi service on Railway
- Start Strapi for development with `railway run yarn run develop` or `railway run npm run develop`
    - This command will run Strapi in development mode with the service variables available locally
- Open your browser to `http://127.0.0.1:1337/admin`

## 📝 Notes

- After your app is deployed, visit the `/admin` endpoint to create your admin user.
- If you want to use npm with this project make sure you delete the `yarn.lock` file after you have ran `npm install`
