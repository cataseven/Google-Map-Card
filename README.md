# Google Maps Card for Home Assistant

A simple and responsive Lovelace custom card that displays the location of `person.`, `zone.` or `device_tracker.` entities and tracks their routes using the Google Maps JavaScript API.

<br>

# Features

- Street View  
- Route tracking  
- Themes (40+ built‑in)  
- Interactive Google Map view  
- Dynamic selection of person/zone/device_tracker entities  
- Map terrain types (Map, Satellite, Hybrid, Terrain)  
- Custom zoom level  
- Fully responsive iframe layout with `aspect_ratio`  
- **Show/hide map controls** (Pan, Zoom, Street View, Fullscreen, Map Type, Rotate)  
- **Control positions of buttons**
- **Scale bar** and **keyboard shortcuts** support  
- **Follow** mode: auto‑center map on selected entity/entities  

<br>

# Attention

💡 Google Maps JavaScript API must be enabled in your Google Cloud project:  
https://console.cloud.google.com/google/maps-apis/api-list

![image4](images/gm4.png)

💡 Most Google APIs have quotas and exceeding limits may incur charges.  
Google Maps JavaScript API itself has no daily limit, but watch your monthly quota.

Create API key and click the “Show key” button in the console:

![image5](images/gm5.png)

---

<br>

# Installation

## Via HACS (Recommended)

1. Go to **HACS**  
2. Search for **Google Map Card**  
3. Download & install  

## Manual

1. Download `google-map-card.js` and `themes.js`  
2. Place them in `www/community/google-map-card/`  
3. Add to your Lovelace **resources**:

    ```yaml
    resources:
      - url: /local/community/google-map-card/google-map-card.js
        type: module
    ```

<br>

# Adding the Card to Dashboard

Add via the Lovelace card picker (search “Google Map Card”)  
or define it in YAML (see Card Example below):

<br>

![image11](images/gm11.png)

<br>


## 🔧 Parameters

### 🧹 General Options

| Key            | Type    | Description                                                                   |
| -------------- | ------- | ----------------------------------------------------------------------------- |
| `type`         | string  | Required for Home Assistant custom card. Must be `custom:google-map-card`.    |
| `api_key`      | string  | Your Google Maps Embed API key (**required**).                                |
| `zoom`         | integer | Initial zoom level (1–20).                                                    |
| `theme_mode`   | string  | Map theme name from built-in themes (`Dark_Blueish_Night`, etc.).             |
| `aspect_ratio` | string  | Card aspect ratio (`16:9`, `4:3`, `1`, `1:1.56`, `400px`, etc.).              |
| `map_type`     | string  | Map type: `roadmap`, `satellite`, `hybrid`, or `terrain`. Default: `roadmap`. |
| `marker_clustring`     | boolean  | If `true`, route history markers will be groupped depending on zoom level. Increases performance for slow systems. |

### 👤 Entities

| Key                | Type    | Description                                                                                                          |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `entities`         | list    | A list of `device_tracker`, `person`, or `zone` entities to show on the map (**required**).                          |
| `entity`           | string  | Entity ID to track.                                                                                                  |
| `icon_size`        | integer | Size of the icon for this entity.                                                                                    |
| `icon_color`       | string  | Icon color (e.g., `#ffffff`).                                                                                        |
| `background_color` | string  | Background color of the icon.                                                                                        |
| `hours_to_show`    | integer | Number of hours of location history to show. Use `0` to disable history.                                             |
| `polyline_color`   | string  | Color of the polyline for route history.                                                                             |
| `polyline_width`   | integer | Width of the polyline for route history.                                                                             |
| `follow`           | boolean | If `true`, map will center on this entity. When multiple entities have `follow: true`, the map will fit all of them. |

### 🕹️ Map Buttons

| Key                 | Type    | Description                                                                                     |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `cameraControl`     | boolean | Show or hide pan control.                                                                       |
| `zoomControl`       | boolean | Show or hide zoom control.                                                                      |
| `streetViewControl` | boolean | Show or hide Street View control.                                                               |
| `fullscreenControl` | boolean | Show or hide fullscreen control.                                                                |
| `mapTypeControl`    | boolean | Show or hide map type selector.                                                                 |
| `rotateControl`     | boolean | Show or hide rotate/tilt control. Only works in some cities or zoom levels (Google limitation). |
| `showScale`         | boolean | Show or hide the scale bar.                                                                     |
| `keyboardShortcuts` | boolean | Enable or disable keyboard shortcuts for navigation.                                            |

### 🔝 Button Positions

| Key                          | Type   | Description                                         |
| ---------------------------- | ------ | --------------------------------------------------- |
| `cameraControl_position`     | string | Position of the pan control (e.g., `RIGHT_BOTTOM`). |
| `zoomControl_position`       | string | Position of the zoom control.                       |
| `streetViewControl_position` | string | Position of the Street View control.                |
| `fullscreenControl_position` | string | Position of the fullscreen control.                 |
| `mapTypeControl_position`    | string | Position of the map type selector.                  |
| `rotateControl_position`     | string | Position of the rotate/tilt control.                |

### 🎯 Zones

| Key       | Type    | Description                                               |
| --------- | ------- | --------------------------------------------------------- |
| `zones`   | object  | Defines `zone` entities to show on the map, with styling. |
| `show`    | boolean | Whether to display the zone or not.                       |
| `color`   | string  | Fill color for the zone area (e.g., `#3498db`).           |
| `opacity` | float   | Opacity for the zone fill color (0.0 to 1.0).             |


**The following control positions are supported:** 

`TOP_LEFT`, `TOP_CENTER`, `TOP_RIGHT`,  
`LEFT_TOP`, `LEFT_CENTER`, `LEFT_BOTTOM`,  
`RIGHT_TOP`, `RIGHT_CENTER`, `RIGHT_BOTTOM`,  
`BOTTOM_LEFT`, `BOTTOM_CENTER`, `BOTTOM_RIGHT`

| Position         | Description                                                                                                           |
|------------------|-----------------------------------------------------------------------------------------------------------------------|
| `TOP_CENTER`     | Control placed along the top center of the map.                                                                       |
| `TOP_LEFT`       | Control placed along the top left of the map, with sub‑elements “flowing” toward the top center.                      |
| `TOP_RIGHT`      | Control placed along the top right of the map, with sub‑elements “flowing” toward the top center.                     |
| `LEFT_TOP`       | Control placed along the top left of the map, but below any `TOP_LEFT` elements.                                      |
| `RIGHT_TOP`      | Control placed along the top right of the map, but below any `TOP_RIGHT` elements.                                    |
| `LEFT_CENTER`    | Control placed along the left side of the map, centered between `TOP_LEFT` and `BOTTOM_LEFT`.                         |
| `RIGHT_CENTER`   | Control placed along the right side of the map, centered between `TOP_RIGHT` and `BOTTOM_RIGHT`.                      |
| `LEFT_BOTTOM`    | Control placed along the bottom left of the map, but above any `BOTTOM_LEFT` elements.                                |
| `RIGHT_BOTTOM`   | Control placed along the bottom right of the map, but above any `BOTTOM_RIGHT` elements.                              |
| `BOTTOM_CENTER`  | Control placed along the bottom center of the map.                                                                    |
| `BOTTOM_LEFT`    | Control placed along the bottom left of the map, with sub‑elements “flowing” toward the bottom center.                |
| `BOTTOM_RIGHT`   | Control placed along the bottom right of the map, with sub‑elements “flowing” toward the bottom center.               |


<br>

# UI Card Editor

![image61](images/ui1.png) ![image62](images/ui2.png)
<br>
![image63](images/ui3.png) ![image64](images/ui4.png)
<br>
![image64](images/ui5.png)
<br>

# Enabling Clustring

If you set clustring on then route history markers will be groupped accordingto zoom zevel. More zoom more granularity. This increases performance on slow systems
![image7](images/cluster.png)  

# Themes

You can choose your best theme—40 now and more to come!  
![image7](images/gm7.png)  
![image8](images/gm8.png)

<br>

# Card Example

```yaml
type: custom:google-map-card
api_key: <<YOUR API KEY>>
zoom: 10
theme_mode: Dark_Blueish_Night
aspect_ratio: "1:1.56"
map_type: roadmap
marker_clustering: true
cameraControl: true
cameraControl_position: RIGHT_BOTTOM
zoomControl: true
zoomControl_position: RIGHT_BOTTOM
streetViewControl: true
streetViewControl_position: LEFT_BOTTOM
fullscreenControl: true
fullscreenControl_position: TOP_RIGHT
mapTypeControl: true
mapTypeControl_position: TOP_LEFT
rotateControl: true
rotateControl_position: LEFT_BOTTOM
showScale: true
keyboardShortcuts: true
zones:
  zone.work:
    show: true
    color: "#3498db"
    opacity: 0.25
  zone.work_2:
    show: true
    color: "#3498db"
    opacity: 0.25
  zone.efendilig:
    show: true
    color: "#3498db"
    opacity: 0.25
  zone.bahcesehir:
    show: true
    color: "#3498db"
    opacity: 0.25
  zone.home:
    show: true
    color: "#3498db"
    opacity: 0.25
  zone.kuzguncuk:
    show: true
    color: "#3498db"
    opacity: 0.25
  zone.school:
    show: true
    color: "#3498db"
    opacity: 0.25
  zone.pond:
    show: true
    color: "#3498db"
    opacity: 0.25
entities:
  - entity: device_tracker.flightradar24
    icon_size: 25
    hours_to_show: 6
    polyline_color: "#ffffff"
    polyline_width: 1
    icon_color: "#940000"
    background_color: "#f5f5f5"
    follow: true
  - entity: person.cenk
    icon_size: 40
    hours_to_show: 0
    polyline_color: "#f1eeee"
    polyline_width: 1
    icon_color: "#ffffff"
    background_color: "#f5f5f5"
  - entity: person.derya
    icon_size: 40
    hours_to_show: 0
    polyline_color: "#ffffff"
    polyline_width: 1
    icon_color: "#ffffff"
    background_color: "#ffffff"
```

# Screenshots

![image1](images/gm1.png)  
![image2](images/gm2.png)  
![image3](images/gm3.png)

## ⭐ Support
If you like this card, feel free to ⭐ star the project on GitHub and share it with the Home Assistant community!
