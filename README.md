# Google Map Person Card

A simple and responsive Lovelace custom card that displays the location of a `person.` entity using the Google Maps Embed API. 

💡 Google Maps Embed API must be enabled in your Google Cloud project.

## Features

- Interactive Google Map view
- Dynamic selection of person entities
- Map type selector (roadmap, satellite, hybrid, terrain)
- Custom zoom level
- Fully responsive iframe layout
- No additional dependencies required

---

## Installation

### Via HACS (Recommended)

1. Go to **HACS > Frontend > Custom Repositories**
2. Add this repository URL:  
   `https://github.com/YOUR_USERNAME/google-map-person-card`
3. Choose "Lovelace" as the category and click **Add**
4. Find "Google Map Person Card" in the HACS store and install
5. Make sure it is loaded in `resources:` (HACS should do this automatically)

### Manual

1. Download `google-map-person-card.js`
2. Place it in `www/community/google-map-person-card/`
3. Add the following to your Lovelace `resources:` section:

resources:
  - url: /local/community/google-map-person-card/google-map-person-card.js
    type: module

## Parameters

| Key        | Type    | Description                                              |
| ---------- | ------- | -------------------------------------------------------- |
| `api_key`  | string  | Your Google Maps Embed API key (required)                |
| `entities` | list    | One or more `person.` entities to select from (required) |
| `zoom`     | integer | Zoom level (1–20) (optional)                             |
| `theme`    | string  | light, dark (optional)                                   |
| `icon_size`| integer | (optional)                                               |

## Card Example
```
type: custom:google-map-person-card
api_key: 123456789101112
entities:
  - person.cenk
  - person.derya
  - person.mine
zoom: 14
icon_size: 45
theme_mode: dark
```

## Screenshot
