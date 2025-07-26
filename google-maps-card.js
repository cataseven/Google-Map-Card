import {
    get_map_themes
} from './themes.js';

class GoogleMapCard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({
            mode: 'open'
        });
        this.map = null;
        this.markers = []; // Ana entity markerları
        this.historyMarkers = new Map(); // Geçmiş konum markerları
        this.polylines = new Map();
        this.apiKeyLoaded = false;
        this.initialized = false;
        this.firstDraw = true;
        this.locationHistory = {};
        this.allThemes = get_map_themes();
        this.selectedThemeStyles = [];
    }

    connectedCallback() {
        if (!this.initialized) {
            this._setup();
        }
    }

    _setup() {
        if (!window.google || !window.google.maps) {
            this._loadGoogleMapsScript().then(() => {
                this.apiKeyLoaded = true;
                this._initialRender();
            }).catch(err => {
                this.shadowRoot.innerHTML = `<div style="color:red;">Failed to load Google Maps: ${err}</div>`;
            });
        } else {
            this.apiKeyLoaded = true;
            this._initialRender();
        }
        this.initialized = true;
    }

    setConfig(config) {
        if (!config.entities || !config.api_key) {
            throw new Error("Please provide 'entities' and 'api_key' configurations.");
        }
        this._firstLoadHistoryNeeded = true;

        this.config = config;
        this.zoom = config.zoom || 11;
        this.mapType = config.map_type || 'roadmap';
        this.themeName = config.theme_mode || 'Dark_Blueish_Night';
        this.aspectRatio = config.aspect_ratio || null;


        this.showScale = config.showScale ?? true;
        this.keyboardShortcuts = config.keyboardShortcuts ?? true;
        this.cameraControl = config.cameraControl ?? true;
        this.zoomControl = config.zoomControl ?? true;
        this.streetViewControl = config.streetViewControl ?? true;
        this.fullscreenControl = config.fullscreenControl ?? true;
        this.mapTypeControl = config.mapTypeControl ?? true;
        this.rotateControl = config.rotateControl ?? true;

        this.cameraControlPosition = config.cameraControl_position || 'RIGHT_BOTTOM';
        this.zoomControlPosition = config.zoomControl_position || 'RIGHT_BOTTOM';
        this.streetViewControlPosition = config.streetViewControl_position || 'LEFT_BOTTOM';
        this.fullscreenControlPosition = config.fullscreenControl_position || 'TOP_RIGHT';
        this.mapTypeControlPosition = config.mapTypeControl_position || 'TOP_LEFT';
        this.rotateControlPosition = config.rotateControl_position || 'LEFT_BOTTOM';

        this.selectedThemeStyles = [];
        for (const mode in this.allThemes) {
            if (this.allThemes[mode][this.themeName]) {
                this.selectedThemeStyles = this.allThemes[mode][this.themeName];
                break;
            }
        }

        this.globalIconSize = config.icon_size || 20;
        this.globalIconColor = config.icon_color || '#FFFFFF';
        this.globalBackgroundColor = config.background_color || '#FFFFFF';

        this.entityConfigs = {};
        this.config.entities.forEach(entityConfig => {
            const entityId = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
            this.entityConfigs[entityId] = {
                polyline_color: entityConfig.polyline_color || '#FFFFFF',
                icon_size: entityConfig.icon_size || this.globalIconSize,
                hours_to_show: typeof entityConfig.hours_to_show === 'number' ? entityConfig.hours_to_show : 0,
                icon_color: entityConfig.icon_color || this.globalIconColor,
                background_color: entityConfig.background_color || this.globalBackgroundColor,
                polyline_width: typeof entityConfig.polyline_width === 'number' ? entityConfig.polyline_width : 1,
                follow: entityConfig.follow || false,
                history_dot_size: typeof entityConfig.history_dot_size === 'number' ? entityConfig.history_dot_size : 4,
            };
        });

        if (this.map && this.apiKeyLoaded) {
            this._drawMap();
        }
    }

    set hass(hass) {
        this._hass = hass;
        if (this.apiKeyLoaded && this.map) {
            if (this._firstLoadHistoryNeeded) {
                this._loadAllInitialHistory();
                this._firstLoadHistoryNeeded = false;
            }
            this._updateHistory();
            this._updateMarkers();
        }
    }

    _loadGoogleMapsScript() {
        if (window.google && window.google.maps) {
            return Promise.resolve();
        }
        if (window._googleMapsPromise) {
            return window._googleMapsPromise;
        }
        window._googleMapsPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${this.config.api_key}&libraries=geometry`;
            script.async = true;
            script.defer = true;
            script.onload = () => {
                resolve();
            };
            script.onerror = () => {
                window._googleMapsPromise = null;
                reject(new Error('Failed to load Google Maps script'));
            };
            document.head.appendChild(script);
        });

        return window._googleMapsPromise;
    }

    _initialRender() {
        let aspectRatioStyle = '';
        let mapClasses = '';

        if (this.aspectRatio) {
            try {
                const ratioValue = eval(this.aspectRatio.replace(':', '/'));
                const paddingBottomPercentage = (1 / ratioValue) * 100;
                aspectRatioStyle = `height: 0; padding-bottom: ${paddingBottomPercentage}%; position: relative;`;
                mapClasses = 'aspect-ratio-container';
            } catch (e) {
                console.warn(`Invalid aspect_ratio format: ${this.aspectRatio}. Using default height.`, e);
                aspectRatioStyle = `height: 350px; min-height: 350px;`;
            }
        } else {
            aspectRatioStyle = `height: 350px; min-height: 350px;`;
        }

        const style = `
        <style>
          #map {
            width: 100%;
            ${aspectRatioStyle}
            border-radius: 8px;
            min-width: 300px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          #map.aspect-ratio-container > div {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
          }
          .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 16px;
            background: white;
            padding: 10px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 10;
          }
        </style>
      `;

        this.shadowRoot.innerHTML = `
        ${style}
        <div id="map" class="${mapClasses}">
          <div class="loading">Loading map...</div>
        </div>
      `;

        this._drawMap();
    }

    async _drawMap() {
        if (!this._hass || !this.config) return;

        const mapEl = this.shadowRoot.getElementById('map');
        if (!mapEl) return;

        const locations = this._getCurrentLocations();
        if (locations.length === 0 && !this._firstLoadHistoryNeeded) {
            mapEl.innerHTML = `<p>No location data available for the configured entities.</p>`;
            this._clearMarkers(true);
            this._clearHistoryMarkers();
            return;
        }

        const loading = this.shadowRoot.querySelector('.loading');
        if (loading) loading.remove();

        if (this.firstDraw) {
            const avgLat = locations.reduce((sum, loc) => sum + loc.lat, 0) / locations.length;
            const avgLon = locations.reduce((sum, loc) => sum + loc.lon, 0) / locations.length;

            const mapOptions = {
                center: {
                    lat: avgLat,
                    lng: avgLon
                },
                zoom: this.zoom,
                mapTypeId: this.mapType,
                scaleControl: this.showScale,
                keyboardShortcuts: this.keyboardShortcuts,
                cameraControl: this.cameraControl,
                cameraControlOptions: {
                    position: google.maps.ControlPosition[this.cameraControlPosition]
                },
                zoomControl: this.zoomControl,
                zoomControlOptions: {
                    position: google.maps.ControlPosition[this.zoomControlPosition]
                },
                streetViewControl: this.streetViewControl,
                streetViewControlOptions: {
                    position: google.maps.ControlPosition[this.streetViewControlPosition]
                },
                fullscreenControl: this.fullscreenControl,
                fullscreenControlOptions: {
                    position: google.maps.ControlPosition[this.fullscreenControlPosition]
                },
                mapTypeControl: this.mapTypeControl,
                mapTypeControlOptions: {
                    position: google.maps.ControlPosition[this.mapTypeControlPosition]
                },
                rotateControl: this.rotateControl,
                rotateControlOptions: {
                    position: google.maps.ControlPosition[this.rotateControlPosition]
                }
            };

            if (this.selectedThemeStyles.length > 0) {
                mapOptions.styles = this.selectedThemeStyles;
            }

            this.map = new google.maps.Map(mapEl, mapOptions);
            this.firstDraw = false;
        }

        if (this._firstLoadHistoryNeeded) {
            await this._loadAllInitialHistory();
            this._firstLoadHistoryNeeded = false;
        }

        await this._updateMarkers();
    }

    async _loadHistoryForEntity(entityId, hoursToShow) {
        if (!this._hass || hoursToShow <= 0) {
            return [];
        }

        const now = new Date();
        const start = new Date(now.getTime() - hoursToShow * 3600 * 1000).toISOString();
        const end = now.toISOString();

        try {
            const response = await this._hass.callApi('GET', `history/period/${start}?filter_entity_id=${entityId}&end_time=${end}`);

            if (response && response[0]) {
                return response[0]
                    .filter(state => state.attributes.latitude && state.attributes.longitude)
                    .map(state => ({
                        lat: state.attributes.latitude,
                        lon: state.attributes.longitude,
                        timestamp: new Date(state.last_updated).getTime()
                    }));
            }
        } catch (error) {
            console.error(`Failed to load history for ${entityId}:`, error);
        }
        return [];
    }

    async _resolveTrackerEntity(entityId) {
        if (!this._hass || !entityId.startsWith('person.')) {
            return entityId;
        }
        const personState = this._hass.states[entityId];
        if (personState && personState.attributes.source) {
            console.log(`Resolved ${entityId} to its source: ${personState.attributes.source}`);
            return personState.attributes.source;
        }
        return entityId;
    }

    async _loadAllInitialHistory() {
        this.locationHistory = {};
        const promises = this.config.entities.map(async entityConfig => {
            const originalEid = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
            const trackerEid = await this._resolveTrackerEntity(originalEid);

            const entitySpecificConfig = this.entityConfigs[originalEid];
            if (entitySpecificConfig && entitySpecificConfig.hours_to_show > 0) {
                const history = await this._loadHistoryForEntity(trackerEid, entitySpecificConfig.hours_to_show);
                this.locationHistory[originalEid] = history;
            }
        });
        await Promise.all(promises);
        if (this.map) {
            this._updateMarkers();
        }
    }


    _updateHistory() {
        const now = new Date();

        this.config.entities.forEach(entityConfig => {
            const eid = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
            const entitySpecificConfig = this.entityConfigs[eid];

            if (!entitySpecificConfig) return;

            const state = this._hass.states[eid];
            if (!state || !state.attributes.latitude || !state.attributes.longitude) return;

            const hoursToShowForEntity = entitySpecificConfig.hours_to_show;
            const cutoff = hoursToShowForEntity > 0 ?
                now.getTime() - hoursToShowForEntity * 3600 * 1000 :
                Number.MAX_SAFE_INTEGER;

            if (!this.locationHistory[eid]) {
                this.locationHistory[eid] = [];
            }

            const lastEntry = this.locationHistory[eid][this.locationHistory[eid].length - 1];
            const latChanged = lastEntry ? Math.abs(lastEntry.lat - state.attributes.latitude) > 0.000001 : true;
            const lonChanged = lastEntry ? Math.abs(lastEntry.lon - state.attributes.longitude) > 0.000001 : true;

            if (!lastEntry || (latChanged || lonChanged)) {
                this.locationHistory[eid].push({
                    lat: state.attributes.latitude,
                    lon: state.attributes.longitude,
                    timestamp: new Date(state.last_updated).getTime()
                });
            }

            this.locationHistory[eid] = this.locationHistory[eid].filter(entry =>
                entry.timestamp >= cutoff
            );
        });
    }

    _getCurrentLocations() {
        return this.config.entities
            .map(entityConfig => {
                const eid = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
                const state = this._hass.states[eid];
                if (!state || !state.attributes.latitude || !state.attributes.longitude) return null;

                const entitySpecificConfig = this.entityConfigs[eid];
                if (!entitySpecificConfig) return null;

                return {
                    id: eid,
                    name: state.attributes.friendly_name || eid,
                    lat: state.attributes.latitude,
                    lon: state.attributes.longitude,
                    picture: state.attributes.entity_picture,
                    icon: state.attributes.icon || this._getDefaultIcon(eid),
                    state: state.state,
                    icon_size: entitySpecificConfig.icon_size,
                    hours_to_show: entitySpecificConfig.hours_to_show,
                    icon_color: entitySpecificConfig.icon_color,
                    background_color: entitySpecificConfig.background_color,
                    polyline_width: entitySpecificConfig.polyline_width,
                    follow: entitySpecificConfig.follow,
                    history_dot_size: entitySpecificConfig.history_dot_size,
                };
            })
            .filter(Boolean);
    }

    _getDefaultIcon(entityId) {
        if (entityId.includes('person')) return 'mdi:account';
        if (entityId.includes('vehicle')) return 'mdi:car';
        if (entityId.includes('device_tracker')) return 'mdi:cellphone';
        if (entityId.includes('zone')) return 'mdi:map-marker-radius';
        return 'mdi:map-marker';
    }

    _updatePolylines() {
        const polylinesToKeep = new Set();

        this.config.entities.forEach(entityConfig => {
            const eid = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
            const entitySpecificConfig = this.entityConfigs[eid];

            if (!entitySpecificConfig) return;

            const hoursToShowForEntity = entitySpecificConfig.hours_to_show;
            const polylineColorForEntity = entitySpecificConfig.polyline_color;
            const polylineWidthForEntity = entitySpecificConfig.polyline_width;

            if (hoursToShowForEntity > 0) {
                const history = this.locationHistory[eid] || [];
                if (history.length >= 2) {
                    const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
                    const path = sortedHistory.map(point => new google.maps.LatLng(point.lat, point.lon));

                    let polyline = this.polylines.get(eid);

                    if (polyline) {
                        polyline.setPath(path);
                        polyline.setOptions({
                            strokeColor: polylineColorForEntity,
                            strokeOpacity: 0.7,
                            strokeWeight: polylineWidthForEntity,
                            icons: []
                        });
                    } else {
                        polyline = new google.maps.Polyline({
                            path: path,
                            geodesic: true,
                            strokeColor: polylineColorForEntity,
                            strokeOpacity: 0.7,
                            strokeWeight: polylineWidthForEntity,
                            map: this.map,
                            icons: []
                        });
                        this.polylines.set(eid, polyline);
                    }
                    polylinesToKeep.add(eid);
                } else if (this.polylines.has(eid)) {
                    this.polylines.get(eid).setMap(null);
                    this.polylines.delete(eid);
                }
            }
        });

        this.polylines.forEach((polyline, eid) => {
            if (!polylinesToKeep.has(eid)) {
                polyline.setMap(null);
                this.polylines.delete(eid);
            }
        });
    }

    async _updateMarkers() {
        const currentLocations = this._getCurrentLocations();
        if (currentLocations.length === 0 && Object.keys(this.locationHistory).every(key => this.locationHistory[key].length === 0)) {
            this._clearMarkers(true);
            this._clearHistoryMarkers();
            this._updatePolylines();
            return;
        }

        // --- YENİ VE SAĞLAM ANA MARKER YÖNETİMİ ---
        const iconPromises = currentLocations.map(async loc => {
            const iconSizeForEntity = loc.icon_size;
            const iconColorForEntity = loc.icon_color;
            const backgroundColorForEntity = loc.background_color;
            const borderSizeForIcon = 2;
            let markerIcon = null;
            let fullPictureUrl = null;
            let fullIconUrl = null;

            if (loc.picture) {
                fullPictureUrl = loc.picture.startsWith('/') ? `${window.location.origin}${loc.picture}` : loc.picture;
                markerIcon = await this._createCircularIcon(fullPictureUrl, iconSizeForEntity, 0, null, null);
            } else if (loc.icon) {
                try {
                    const iconParts = loc.icon.split(':');
                    const iconPrefix = iconParts[0];
                    const iconName = iconParts[1];
                    if (iconPrefix === 'mdi') {
                        fullIconUrl = `https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/${iconName}.svg`;
                    } else {
                        fullIconUrl = `${this._hass.connection.baseUrl}/static/icons/${loc.icon.replace(':', '-')}.png`;
                    }
                    markerIcon = await this._createCircularIcon(fullIconUrl, iconSizeForEntity, borderSizeForIcon, iconColorForEntity, backgroundColorForEntity);
                } catch (e) {
                    console.error('Error creating icon:', e);
                    markerIcon = null;
                }
            }
            return { ...loc, markerIcon, fullPictureUrl, fullIconUrl };
        });

        const locationsWithIcons = await Promise.all(iconPromises);
        const currentEntityIds = new Set(locationsWithIcons.map(loc => loc.id));

        // Mevcut markerları güncelle veya yenilerini oluştur
        locationsWithIcons.forEach(loc => {
            const existingMarker = this.markers.find(m => m.entityId === loc.id);

            const infoContent = `
                <div style="text-align:center; padding:10px; min-width:120px;">
                    ${loc.picture ? `<img src="${loc.fullPictureUrl}" width="${loc.icon_size}" height="${loc.icon_size}" style="border-radius:50%;">` : 
                      loc.icon ? `<ha-icon icon="${loc.icon}" style="width:${loc.icon_size}px; height:${loc.icon_size}px; color: ${loc.icon_color}; background-color: ${loc.background_color}; border-radius: 50%;"></ha-icon>` : ''}
                    <div style="margin-top:8px;font-weight:bold;">${loc.name}</div>
                    <div style="font-size:0.9em;color:#666;">${loc.state}</div>
                </div>
            `;

            if (existingMarker) {
                existingMarker.setPosition({ lat: loc.lat, lng: loc.lon });
                if (JSON.stringify(existingMarker.getIcon()) !== JSON.stringify(loc.markerIcon)) {
                    existingMarker.setIcon(loc.markerIcon || null);
                }
                if (existingMarker.infoWindow) {
                    existingMarker.infoWindow.setContent(infoContent);
                }
            } else {
                const marker = new google.maps.Marker({
                    position: { lat: loc.lat, lng: loc.lon },
                    map: this.map,
                    title: loc.name,
                    icon: loc.markerIcon || null,
                    optimized: true
                });
                marker.entityId = loc.id;
                const infoWindow = new google.maps.InfoWindow({ content: infoContent });
                marker.infoWindow = infoWindow;

                marker.addListener('click', () => {
                    this.markers.forEach(m => { if (m.infoWindow) m.infoWindow.close(); });
                    infoWindow.open(this.map, marker);
                });
                this.markers.push(marker);
            }
        });

        // Artık mevcut olmayan varlıkların markerlarını kaldır
        this.markers = this.markers.filter(marker => {
            if (currentEntityIds.has(marker.entityId)) {
                return true; // Markeri tut
            } else {
                if (marker.infoWindow) marker.infoWindow.close();
                marker.setMap(null); // Haritadan kaldır
                return false; // Diziden kaldır
            }
        });
        // --- ANA MARKER YÖNETİMİ SONU ---


        // Geçmiş konum markerlarını güncelle
        for (const eid in this.locationHistory) {
            let history = this.locationHistory[eid] || [];
            const entitySpecificConfig = this.entityConfigs[eid];

            if (!entitySpecificConfig || entitySpecificConfig.hours_to_show <= 0) {
                if (this.historyMarkers.has(eid)) {
                    this.historyMarkers.get(eid).forEach(m => m.setMap(null));
                    this.historyMarkers.delete(eid);
                }
                continue;
            }
            
            // Son nokta (mevcut konum) için dot çizme, ana marker zaten var.
            if (history.length > 0) {
                history = history.slice(0, -1);
            }

            let currentEntityHistoryMarkers = this.historyMarkers.get(eid) || new Map();
            const newEntityHistoryMarkers = new Map();

            const historyIconPromises = history.map(async point => {
                const pointId = `${point.lat}-${point.lon}-${point.timestamp}`;
                let historyMarker = currentEntityHistoryMarkers.get(pointId);

                if (historyMarker) {
                    newEntityHistoryMarkers.set(pointId, historyMarker);
                } else {
                    const historyDotSize = entitySpecificConfig.history_dot_size;
                    const historyDotIcon = await this._createCircularIcon(
                        null,
                        historyDotSize,
                        0,
                        entitySpecificConfig.polyline_color,
                        entitySpecificConfig.polyline_color
                    );
                    historyMarker = new google.maps.Marker({
                        position: { lat: point.lat, lng: point.lon },
                        map: this.map,
                        icon: historyDotIcon,
                        optimized: true,
                        _pointId: pointId
                    });
                    newEntityHistoryMarkers.set(pointId, historyMarker);
                }
            });
            
            await Promise.all(historyIconPromises);

            currentEntityHistoryMarkers.forEach((marker, pointId) => {
                if (!newEntityHistoryMarkers.has(pointId)) {
                    marker.setMap(null);
                }
            });
            this.historyMarkers.set(eid, newEntityHistoryMarkers);
        }

        this.historyMarkers.forEach((entityMap, eid) => {
            const entityConfig = this.config.entities.find(e => (typeof e === 'string' ? e : e.entity) === eid);
            if (!entityConfig || (entityConfig && this.entityConfigs[eid] && this.entityConfigs[eid].hours_to_show <= 0)) {
                entityMap.forEach(marker => marker.setMap(null));
                this.historyMarkers.delete(eid);
            }
        });

        // Haritayı takip etme mantığı
        const followedEntities = this._getCurrentLocations().filter(loc => loc.follow);
        if (followedEntities.length === 1) {
            const followed = followedEntities[0];
            const newCenter = { lat: followed.lat, lng: followed.lon };
            if (this.map.getCenter().toUrlValue(6) !== `${newCenter.lat},${newCenter.lng}`) {
                this.map.panTo(newCenter);
            }
        } else if (followedEntities.length > 1) {
            const bounds = new google.maps.LatLngBounds();
            followedEntities.forEach(loc => {
                bounds.extend({ lat: loc.lat, lng: loc.lon });
            });
            this.map.fitBounds(bounds, 50);
        }

        this._updatePolylines();
    }


    async _createCircularIcon(imageUrl, size, borderSize = 0, iconColor = null, backgroundColor = null) {
        const canvas = document.createElement('canvas');

        const contentDiameter = size;
        const iconPadding = imageUrl && imageUrl.endsWith('.svg') ? 4 : 0;
        const borderThickness = imageUrl && imageUrl.endsWith('.svg') ? borderSize : 0;

        const totalCanvasDiameter = contentDiameter + (2 * iconPadding) + (2 * borderThickness);
        canvas.width = totalCanvasDiameter;
        canvas.height = totalCanvasDiameter;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, totalCanvasDiameter, totalCanvasDiameter);

        const centerX = totalCanvasDiameter / 2;
        const centerY = totalCanvasDiameter / 2;

        if (backgroundColor) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, totalCanvasDiameter / 2, 0, Math.PI * 2);
            ctx.fillStyle = backgroundColor;
            ctx.fill();
        }

        if (imageUrl && imageUrl.endsWith('.svg') && borderThickness > 0) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, (totalCanvasDiameter - borderThickness) / 2, 0, Math.PI * 2);
            ctx.strokeStyle = iconColor || '#000000';
            ctx.lineWidth = borderThickness;
            ctx.stroke();
        }

        if (imageUrl) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, contentDiameter / 2, 0, Math.PI * 2);
            ctx.clip();

            const drawX = (totalCanvasDiameter - contentDiameter) / 2;
            const drawY = (totalCanvasDiameter - contentDiameter) / 2;

            if (imageUrl.endsWith('.svg')) {
                try {
                    const response = await fetch(imageUrl);
                    let svgText = await response.text();

                    if (iconColor) {
                        svgText = svgText.replace(/fill="[^"]*?"/g, `fill="${iconColor}"`);
                        svgText = svgText.replace(/stroke="[^"]*?"/g, `stroke="${iconColor}"`);
                        svgText = svgText.replace(/style="([^"]*?)(fill:[^;]*?;?|stroke:[^;]*?;?)"/g, (match, p1) => {
                            let newStyle = p1.replace(/fill:[^;]*;?/g, `fill:${iconColor};`).replace(/stroke:[^;]*;?/g, `stroke:${iconColor};`);
                            return `style="${newStyle}"`;
                        });
                        if (!svgText.includes('fill=') && !svgText.includes('stroke=') && svgText.includes('<path')) {
                            svgText = svgText.replace(/<path/g, `<path fill="${iconColor}"`);
                        }
                    }

                    const svgBlob = new Blob([svgText], {
                        type: 'image/svg+xml;charset=utf-8'
                    });
                    const newImageUrl = URL.createObjectURL(svgBlob);

                    return new Promise((resolveInner) => {
                        const image = new Image();
                        image.onload = () => {
                            ctx.drawImage(image, drawX, drawY, contentDiameter, contentDiameter);
                            URL.revokeObjectURL(newImageUrl);
                            resolveInner({
                                url: canvas.toDataURL(),
                                scaledSize: new google.maps.Size(totalCanvasDiameter, totalCanvasDiameter),
                                anchor: new google.maps.Point(totalCanvasDiameter / 2, totalCanvasDiameter / 2)
                            });
                        };
                        image.onerror = () => {
                            console.warn('Failed to load modified SVG image for marker:', imageUrl);
                            URL.revokeObjectURL(newImageUrl);
                            resolveInner(null);
                        };
                        image.src = newImageUrl;
                    });

                } catch (e) {
                    console.error('Error fetching or processing SVG:', e);
                    return null;
                }
            } else {
                return new Promise((resolveInner) => {
                    const image = new Image();
                    image.crossOrigin = 'Anonymous';
                    image.onload = () => {
                        ctx.drawImage(image, drawX, drawY, contentDiameter, contentDiameter);
                        resolveInner({
                            url: canvas.toDataURL(),
                            scaledSize: new google.maps.Size(totalCanvasDiameter, totalCanvasDiameter),
                            anchor: new google.maps.Point(totalCanvasDiameter / 2, totalCanvasDiameter / 2)
                        });
                    };
                    image.onerror = () => {
                        console.warn('Failed to load image for marker:', imageUrl);
                        resolveInner(null);
                    };
                    image.src = imageUrl;
                });
            }
        } else {
            return Promise.resolve({
                url: canvas.toDataURL(),
                scaledSize: new google.maps.Size(totalCanvasDiameter, totalCanvasDiameter),
                anchor: new google.maps.Point(totalCanvasDiameter / 2, totalCanvasDiameter / 2)
            });
        }
    }

    _clearMarkers(clearAll = false) {
        if (clearAll) {
            this.markers.forEach(marker => {
                if (marker.infoWindow) marker.infoWindow.close();
                marker.setMap(null);
            });
            this.markers = [];
        }
    }

    _clearHistoryMarkers() {
        this.historyMarkers.forEach(entityMap => {
            entityMap.forEach(marker => marker.setMap(null));
        });
        this.historyMarkers.clear();
    }

    getCardSize() {
        return 4;
    }
}

customElements.define('google-map-card', GoogleMapCard);


class GoogleMapCardEditor extends HTMLElement {
    constructor() {
        super();
        this._config = {};
        this._tmpConfig = {};
        this._hass = null;
        this.attachShadow({
            mode: 'open'
        });
        this.themes = get_map_themes();
        this._initialRender = true;
        this.controlPositions = [
            'TOP_CENTER', 'TOP_LEFT', 'TOP_RIGHT', 'LEFT_TOP', 'RIGHT_TOP',
            'LEFT_CENTER', 'RIGHT_CENTER', 'LEFT_BOTTOM', 'RIGHT_BOTTOM',
            'BOTTOM_CENTER', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'
        ];
    }

    setConfig(config) {
        this._config = JSON.parse(JSON.stringify(config));
        this._tmpConfig = JSON.parse(JSON.stringify(config));
        this._render();
    }

    set hass(hass) {
        this._hass = hass;
    }

    get _entities() {
        return this._tmpConfig.entities || [];
    }

    _getAvailableEntities() {
        if (!this._hass || !this._hass.states) {
            return [];
        }
        const filteredEntities = Object.keys(this._hass.states).filter(entityId =>
            entityId.startsWith('person.') ||
            entityId.startsWith('zone.') ||
            entityId.startsWith('device_tracker.')
        );
        return filteredEntities.sort();
    }

    _render() {
        const activeElement = this.shadowRoot.activeElement;
        let activeElementState = {
            path: null,
            selectionStart: -1,
            selectionEnd: -1,
        };

        let entityCollapseStates = {};
        let appearanceCollapsed;
        let controlsCollapsed;

        if (this._initialRender) {
            appearanceCollapsed = true;
            controlsCollapsed = true;
            this._entities.forEach((_, index) => {
                entityCollapseStates[index] = true;
            });
            this._initialRender = false;
        } else {
            this.shadowRoot.querySelectorAll('.entity-item').forEach(item => {
                entityCollapseStates[item.dataset.index] = item.classList.contains('collapsed');
            });
            const appearanceHeader = this.shadowRoot.getElementById('appearance-header');
            appearanceCollapsed = appearanceHeader ? appearanceHeader.classList.contains('collapsed') : false;
            const controlsHeader = this.shadowRoot.getElementById('controls-header');
            controlsCollapsed = controlsHeader ? controlsHeader.classList.contains('collapsed') : false;
        }

        if (activeElement) {
            let path = [];
            let current = activeElement;
            while (current && current !== this.shadowRoot) {
                let id = current.id;
                let classes = Array.from(current.classList).join('.');
                let tag = current.tagName.toLowerCase();
                let part = tag;
                if (id) part += `#${id}`;
                if (classes) part += `.${classes}`;

                const entityItem = current.closest('.entity-item');
                if (entityItem && current.hasAttribute('data-index')) {
                    path.unshift(`[data-index="${current.dataset.index}"]`);
                } else {
                    let parent = current.parentNode;
                    if (parent) {
                        let siblings = Array.from(parent.children);
                        let ownIndex = siblings.indexOf(current);
                        part += `:nth-child(${ownIndex + 1})`;
                    }
                }
                path.unshift(part);
                current = current.parentElement;
            }
            activeElementState.path = path.join(' > ');

            try {
                activeElementState.selectionStart = activeElement.selectionStart;
                activeElementState.selectionEnd = activeElement.selectionEnd;
            } catch (e) {}
        }

        const theme = this._tmpConfig.theme_mode || 'Auto';
        const aspect = this._tmpConfig.aspect_ratio || '';
        const zoom = this._tmpConfig.zoom || 11;
        const showScale = this._tmpConfig.showScale ?? true;
        const keyboardShortcuts = this._tmpConfig.keyboardShortcuts ?? true;
        const cameraControl = this._tmpConfig.cameraControl ?? true;
        const zoomControl = this._tmpConfig.zoomControl ?? true;
        const streetViewControl = this._tmpConfig.streetViewControl ?? true;
        const fullscreenControl = this._tmpConfig.fullscreenControl ?? true;
        const mapTypeControl = this._tmpConfig.mapTypeControl ?? true;
        const rotateControl = this._tmpConfig.rotateControl ?? true;

        const isApiKeySet = this._config && this._config.api_key;
        const apiKeyInputValue = isApiKeySet ? '' : (this._tmpConfig.api_key || '');
        const apiKeyPlaceholder = isApiKeySet ? '***********************' : 'Insert your Google Maps API Key';

        const allThemes = Object.keys(this.themes['dark'] || {}).concat(Object.keys(this.themes['light'] || {}));
        const uniqueThemes = [...new Set(allThemes)].sort();
        const themeOptions = ['Auto', ...uniqueThemes]
            .map(t => `<option value="${t}" ${t === theme ? 'selected' : ''}>${t}</option>`).join('');

        const availableEntities = this._getAvailableEntities();

        let entitiesHtml = this._entities.map((e, index) => {
            const entityId = typeof e === 'string' ? e : e.entity;
            const iconSize = e.icon_size !== undefined ? e.icon_size : this._tmpConfig.icon_size || 20;
            const entityHours = e.hours_to_show !== undefined ? e.hours_to_show : 0;
            const polylineColor = e.polyline_color || '#FFFFFF';
            const polylineWidth = e.polyline_width !== undefined ? e.polyline_width : 1;
            const iconColor = e.icon_color || '#780202';
            const backgroundColor = e.background_color || '#FFFFFF';
            const follow = e.follow || false;
            const historyDotSize = e.history_dot_size !== undefined ? e.history_dot_size : 4; // Yeni ayar

            const isCollapsed = entityCollapseStates[index];
            const collapsedClass = isCollapsed ? 'collapsed' : '';
            const arrowDirection = isCollapsed ? '►' : '▼';

            const entitySelectOptions = availableEntities
                .map(id => `<option value="${id}" ${id === entityId ? 'selected' : ''}>${id}</option>`).join('');

            return `
          <div class="entity-item ${collapsedClass}" data-index="${index}">
            <div class="entity-header">
              <span class="drag-handle">☰</span>
              <span class="entity-name">👤 ${entityId || 'Select an entity'}</span>
              <span class="entity-actions">
                <span class="action-icon dropdown-arrow" data-index="${index}">${arrowDirection}</span>
                <span class="action-icon delete-entity" data-index="${index}">✕</span>
              </span>
            </div>
            <div class="entity-details">
                <label>Entity ID:
                    <select class="entity-input entity-id" data-index="${index}" @change=${this._valueChanged}>
                      <option value="" ${!entityId ? 'selected' : ''}>Select an entity...</option>
                      ${entitySelectOptions}
                    </select>
                </label>
                <div class="input-row-grid-three">
                  <label class="font-resizer">Icon Size:
                    <input class="entity-input icon_size" type="text" data-index="${index}" value="${iconSize}" placeholder="e.g. 22" />
                  </label>
                  <label class="font-resizer">Hours to Show:
                    <input class="entity-input hours_to_show" type="text" data-index="${index}" value="${entityHours}" placeholder="e.g. 24" />
                  </label>
                  <label class="font-resizer">Polyline Width:
                    <input class="entity-input polyline_width" type="text" data-index="${index}" value="${polylineWidth}" placeholder="e.g. 1" />
                  </label>
                </div>
                <div class="input-row-grid-three">
                  <label class="font-resizer">Icon Color:
                    <input class="entity-input icon_color" type="color" data-index="${index}" value="${iconColor}" />
                  </label>
                  <label class="font-resizer">BG Color:
                    <input class="entity-input background_color" type="color" data-index="${index}" value="${backgroundColor}" />
                  </label>
                  <label class="font-resizer">Polyline Color:
                    <input class="entity-input polyline_color" type="color" data-index="${index}" value="${polylineColor}" />
                  </label>
                </div>
                <label class="font-resizer">History Dot Size:
                    <input class="entity-input history_dot_size" type="text" data-index="${index}" value="${historyDotSize}" placeholder="e.g. 4" />
                </label>
                
                <div style="margin-top: 15px; margin-bottom: 5px;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                      <input type="checkbox" class="entity-input follow-entity" data-index="${index}" ${follow ? 'checked' : ''} />
                      <span style="margin-left: 8px;">Follow this entity</span>
                    </label>
                </div>
  
            </div>
          </div>
        `;
        }).join('');

        const appearanceCollapsedClass = appearanceCollapsed ? 'collapsed' : '';
        const appearanceContentClass = appearanceCollapsed ? 'hidden' : '';
        const controlsCollapsedClass = controlsCollapsed ? 'collapsed' : '';
        const controlsContentClass = controlsCollapsed ? 'hidden' : '';

        const positionOptions = (controlId, currentValue) => {
            return this.controlPositions.map(pos =>
                `<option value="${pos}" ${pos === currentValue ? 'selected' : ''}>${pos.replace(/_/g, ' ')}</option>`
            ).join('');
        };

        const createControlItem = (id, name, isChecked, positionValue) => `
          <div class="control-item">
              <label class="checkbox-label">
                  <input type="checkbox" id="${id}" ${isChecked ? 'checked' : ''} />
                  <span>${name}</span>
              </label>
              <select id="${id}_position" class="position-select" ${!isChecked ? 'disabled' : ''}>
                  ${positionOptions(id, positionValue)}
              </select>
          </div>
      `;

        this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            padding: 0px;
            --select-arrow-color: var(--secondary-text-color, #888);
            font-family: var(--primary-font-family);
          }
          
          label, input, select, button, .section-title, .entity-name {
            font-family: var(--primary-font-family);
          }
  
          .font-resizer {
              font-size: 85%;
          }
  
          .card-container {
            padding: 0px;
            border-radius: unset;
            box-shadow: none;
            max-width: 1000px;
            margin: auto;
          }
  
          select {
            width: 100%;
            padding: 10px 12px;
            margin-top: 4px;
            margin-bottom: 10px;
            border: 1px solid var(--divider-color);
            border-radius: var(--ha-card-border-radius, 8px);
            box-sizing: border-box;
            background-color: var(--mdc-text-field-fill-color);
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
            color: var(--primary-text-color);
          }
  
          select {
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23888888'%3e%3cpath d='M7 10l5 5 5-5z'/%3e%3csvg%3e");
            background-repeat: no-repeat;
            background-position: right 10px center;
            background-size: 20px;
          }
  
          select option {
            background-color: var(--card-background-color, var(--ha-card-background, white));
            color: var(--primary-text-color);
          }
  
          select:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 1px var(--primary-color);
            outline: none;
          }
          
          select[disabled] {
            background-color: var(--disabled-text-color);
            opacity: 0.5;
            cursor: not-allowed;
          }
  
          @media (prefers-color-scheme: dark) {
            select {
              background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cccccc'%3e%3cpath d='M7 10l5 5 5-5z'/%3e%3csvg%3e");
            }
          }
  
          .section-header {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            margin: 15px 0;
            border-radius: var(--ha-card-border-radius, 8px);
            cursor: pointer;
            box-shadow: none;
            transition: background-color 0.2s ease;
            background-color: var(--mdc-text-field-fill-color, #f0f0f0);
          }
          
          .section-header:hover {
            background-color: var(--mdc-text-field-fill-color, #e0e0e0);
          }
          
          .section-header .icon {
            margin-right: 10px;
          }
          
          .section-header .arrow {
            margin-left: auto;
            transition: transform 0.2s ease-in-out;
          }
          
          .section-header.collapsed .arrow {
            transform: rotate(-90deg);
          }
          
          .section-content {
            padding: 0 15px 15px;
            border-radius: unset;
          }
          
          .section-content.hidden {
            display: none;
          }
  
          label {
            display: block;
            margin-top: 10px;
            margin-bottom: 5px;
            color: var(--primary-text-color);
          }
          
          input {
            width: 100%;
            padding: 10px 12px;
            margin-top: 4px;
            margin-bottom: 10px;
            border: 1px solid var(--divider-color);
            border-radius: var(--ha-card-border-radius, 8px);
            box-sizing: border-box;
            background-color: var(--mdc-text-field-fill-color);
            color: var(--primary-text-color);
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
          }
          
          input:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 1px var(--primary-color);
            outline: none;
          }
          
          input::placeholder {
            opacity: 0.7;
            color: var(--secondary-text-color);
          }
  
          input[type="checkbox"] {
            width: auto;
            margin: 0;
            accent-color: var(--primary-color);
          }
          
          .checkbox-label {
              display: flex;
              align-items: center;
              cursor: pointer;
          }
          .checkbox-label span {
              margin-left: 8px;
          }
          
          .input-row-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
          }
  
          .input-row-grid + .input-row-grid {
            margin-top: 15px;
          }
  
          .input-row-grid-three {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 15px;
          }
          
          .input-row-grid label,
          .input-row-grid-three label {
            margin-top: 0;
            margin-bottom: 0;
          }
          
          .input-row-grid input,
          .input-row-grid select,
          .input-row-grid-three input,
          .input-row-grid-three select {
            margin-bottom: 0;
          }
  
          .control-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 20px 15px;
          }
          
          .control-item .checkbox-label {
              margin: 0;
          }
          
          .position-select {
              margin-top: 8px;
              margin-bottom: 0;
          }
  
          .entity-list-container {
            margin-top: 7px;
          }
          
          .entity-item {
            border-radius: var(--ha-card-border-radius, 8px);
            margin-bottom: 10px;
            overflow: hidden;
            border: 1px solid var(--divider-color);
            box-shadow: none;
            background-color: var(--card-background-color);
          }
          
          .entity-header {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            cursor: pointer;
            border-bottom: 1px solid var(--divider-color);
            transition: background-color 0.2s ease;
            background-color: var(--mdc-text-field-fill-color, #f0f0f0);
          }
          
          .entity-header:hover {
            background-color: var(--mdc-text-field-fill-color, #e0e0e0);
          }
          
          .entity-header .drag-handle {
            cursor: grab;
            margin-right: 10px;
          }
          
          .entity-header .entity-name {
            flex-grow: 1;
            color: var(--primary-text-color);
          }
          
          .entity-header .action-icon {
            margin-left: 15px;
            cursor: pointer;
            transition: opacity 0.2s ease;
            color: var(--primary-text-color);
          }
          
          .entity-header .action-icon.dropdown-arrow {
            transition: transform 0.2s ease-in-out;
            line-height: 1;
          }
          
          .entity-details {
            padding: 15px;
            border-radius: unset;
            background-color: var(--card-background-color);
            display: block;
          }
          
          .entity-item.collapsed .entity-details {
            display: none;
          }
            
          input[type="color"] {
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
            width: 100%;
            height: 40px;
            padding: 0;
            border: 1px solid var(--divider-color);
            border-radius: var(--ha-card-border-radius, 8px);
            background: none;
            cursor: pointer;
          }
          
          input[type="color"]::-webkit-color-swatch-wrapper {
            padding: 0;
          }
          
          input[type="color"]::-webkit-color-swatch {
            border: none;
            border-radius: calc(var(--ha-card-border-radius, 8px) - 2px);
          }
          
          input[type="color"]::-moz-color-swatch {
            border: none;
            border-radius: calc(var(--ha-card-border-radius, 8px) - 2px);
          }
  
          #add_entity {
            margin-top: 15px;
            padding: 10px 20px;
            background-color: transparent;
            border: 1px solid var(--divider-color);
            border-radius: var(--ha-card-border-radius, 8px);
            cursor: pointer;
            width: 100%;
            box-sizing: border-box;
            transition: background-color 0.2s ease;
            color: var(--primary-text-color);
          }
          
          #add_entity:hover {
            background-color: var(--mdc-text-field-fill-color, rgba(0, 0, 0, 0.05));
          }
          
          #add_entity:active {
            background-color: var(--mdc-text-field-fill-color, rgba(0, 0, 0, 0.1));
          }
  
          .section-title {
            margin-top: 45px;
            color: var(--primary-text-color);
          }
        </style>
        <div class="card-container">
          <div>
              <div class="section-header ${appearanceCollapsedClass}" id="appearance-header">
                  <span class="icon">✨</span> Main Settings
                  <span class="arrow">▼</span>
              </div>
              <div class="section-content ${appearanceContentClass}" id="appearance-content">
                  <div class="input-row-grid">
                      <label>Aspect ratio:
                          <input id="aspect_ratio" value="${aspect}" placeholder="e.g. 16:9 or 0.5" type="text" />
                      </label>
                      <label>Default Zoom:
                          <input id="zoom" type="text" value="${zoom}" placeholder="e.g. 11" />
                      </label>
                  </div>
                  <div class="input-row-grid">
                      <label>Theme Mode:
                          <select id="theme_mode">${themeOptions}</select>
                      </label>
                      <label>Map Type:
                        <select id="map_type">
                                <option value="roadmap" ${this._tmpConfig.map_type === 'roadmap' || !this._tmpConfig.map_type ? 'selected' : ''}>Roadmap</option>
                                <option value="satellite" ${this._tmpConfig.map_type === 'satellite' ? 'selected' : ''}>Satellite</option>
                                <option value="hybrid" ${this._tmpConfig.map_type === 'hybrid' ? 'selected' : ''}>Hybrid</option>
                                <option value="terrain" ${this._tmpConfig.map_type === 'terrain' ? 'selected' : ''}>Terrain</option>
                        </select>
                      </label>
                  </div>
                  <label>API Key:
                      <input id="api_key" value="${apiKeyInputValue}" placeholder="${apiKeyPlaceholder}" type="password" autocomplete="new-password" />
                  </label>
              </div>
              
              <div class="section-header ${controlsCollapsedClass}" id="controls-header">
                  <span class="icon">🕹️</span> Map Buttons (Show/Hide & Positioning)
                  <span class="arrow">▼</span>
              </div>
              <div class="section-content ${controlsContentClass}" id="controls-content">
                  <div class="control-grid">
                      ${createControlItem('cameraControl', 'Pan', cameraControl, this._tmpConfig.cameraControl_position || 'RIGHT_BOTTOM')}
                      ${createControlItem('zoomControl', 'Zoom', zoomControl, this._tmpConfig.zoomControl_position || 'RIGHT_BOTTOM')}
                      ${createControlItem('mapTypeControl', 'Map Type', mapTypeControl, this._tmpConfig.mapTypeControl_position || 'TOP_LEFT')}
                      ${createControlItem('streetViewControl', 'Street View', streetViewControl, this._tmpConfig.streetViewControl_position || 'LEFT_BOTTOM')}
                      ${createControlItem('fullscreenControl', 'Fullscreen', fullscreenControl, this._tmpConfig.fullscreenControl_position || 'TOP_RIGHT')}
                      ${createControlItem('rotateControl', 'Tilt', rotateControl, this._tmpConfig.rotateControl_position || 'LEFT_BOTTOM')}
                  </div>
                  <div style="margin-top:20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <label class="checkbox-label"><input type="checkbox" id="showScale" ${showScale ? 'checked' : ''} /> <span>Scale</span></label>
                    <label class="checkbox-label"><input type="checkbox" id="keyboardShortcuts" ${keyboardShortcuts ? 'checked' : ''} /> <span>Keyboard</span></label>
                  </div>
              </div>
  
              <div class="section-title">Entities (required)</div>
              <div class="entity-list-container">
                  ${entitiesHtml}
              </div>
              <button id="add_entity">➕ Add Entity</button>
          </div>
        </div>
      `;

        this._attachListeners();

        if (activeElementState.path) {
            const newActiveElement = this.shadowRoot.querySelector(activeElementState.path.replace(/:nth-child\(\d+\)/g, ''));
            if (newActiveElement) {
                newActiveElement.focus();
                try {
                    if (newActiveElement.selectionStart !== undefined) {
                        newActiveElement.setSelectionRange(activeElementState.selectionStart, activeElementState.selectionEnd);
                    }
                } catch (e) {}
            }
        }
    }

    _attachListeners() {
        const debounce = (func, delay) => {
            let timeout;
            return function(...args) {
                const context = this;
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(context, args), delay);
            };
        };

        const valueChangedDebounced = debounce(() => this._valueChanged(), 500);

        this.shadowRoot.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('input', valueChangedDebounced);
            input.addEventListener('change', () => this._valueChanged());

            if (input.type === 'checkbox' && (input.id.includes('Control') || input.id.includes('pan'))) {
                input.addEventListener('change', (e) => {
                    const positionSelect = this.shadowRoot.getElementById(`${e.target.id}_position`);
                    if (positionSelect) {
                        positionSelect.disabled = !e.target.checked;
                    }
                });
            }
        });

        this.shadowRoot.getElementById('add_entity')?.addEventListener('click', () => {
            const updated = [...(this._tmpConfig.entities || [])];
            updated.push({
                entity: ''
            });
            this._tmpConfig.entities = updated;
            this._render();
            this._valueChanged();
        });

        this.shadowRoot.querySelectorAll('.entity-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.classList.contains('action-icon')) return;

                const entityItem = header.closest('.entity-item');
                if (entityItem) {
                    entityItem.classList.toggle('collapsed');
                    const arrowSpan = header.querySelector('.dropdown-arrow');
                    if (arrowSpan) {
                        arrowSpan.textContent = entityItem.classList.contains('collapsed') ? '►' : '▼';
                    }
                }
            });
        });

        this.shadowRoot.querySelectorAll('.dropdown-arrow').forEach(arrow => {
            arrow.addEventListener('click', (e) => {
                const entityItem = e.target.closest('.entity-item');
                if (entityItem) {
                    entityItem.classList.toggle('collapsed');
                    e.target.textContent = entityItem.classList.contains('collapsed') ? '►' : '▼';
                }
            });
        });

        this.shadowRoot.querySelectorAll('.delete-entity').forEach(button => {
            button.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                if (!isNaN(index)) {
                    const currentEntities = [...(this._tmpConfig.entities || [])];
                    currentEntities.splice(index, 1);
                    this._tmpConfig.entities = currentEntities;
                    this._render();
                    this._valueChanged();
                }
            });
        });

        this.shadowRoot.getElementById('appearance-header')?.addEventListener('click', (e) => {
            if (e.target.closest('input, label, select')) return;
            const header = this.shadowRoot.getElementById('appearance-header');
            const content = this.shadowRoot.getElementById('appearance-content');
            if (header && content) {
                header.classList.toggle('collapsed');
                content.classList.toggle('hidden');
            }
        });

        this.shadowRoot.getElementById('controls-header')?.addEventListener('click', (e) => {
            if (e.target.closest('input, label, select')) return;
            const header = this.shadowRoot.getElementById('controls-header');
            const content = this.shadowRoot.getElementById('controls-content');
            if (header && content) {
                header.classList.toggle('collapsed');
                content.classList.toggle('hidden');
            }
        });
    }

    _valueChanged() {
        const newConfig = {
            type: 'custom:google-map-card',
        };

        const newApiKey = this.shadowRoot.getElementById('api_key').value;
        if (newApiKey) {
            newConfig.api_key = newApiKey;
        } else if (this._config && this._config.api_key) {
            newConfig.api_key = this._config.api_key;
        }

        const zoom = parseFloat(this.shadowRoot.getElementById('zoom').value);
        const theme = this.shadowRoot.getElementById('theme_mode').value;
        const aspect = this.shadowRoot.getElementById('aspect_ratio').value;
        const mapType = this.shadowRoot.getElementById('map_type').value;

        const controls = ['cameraControl', 'zoomControl', 'streetViewControl', 'fullscreenControl', 'mapTypeControl', 'rotateControl'];
        controls.forEach(control => {
            newConfig[control] = this.shadowRoot.getElementById(control).checked;
            if (newConfig[control]) {
                const position = this.shadowRoot.getElementById(`${control}_position`).value;
                newConfig[`${control}_position`] = position;
            }
        });

        newConfig.showScale = this.shadowRoot.getElementById('showScale').checked;
        newConfig.keyboardShortcuts = this.shadowRoot.getElementById('keyboardShortcuts').checked;

        if (!isNaN(zoom)) newConfig.zoom = zoom;
        if (theme !== 'Auto') newConfig.theme_mode = theme;
        if (aspect) newConfig.aspect_ratio = aspect;
        if (mapType) newConfig.map_type = mapType;

        const newEntities = [];
        this.shadowRoot.querySelectorAll('.entity-item').forEach((entityItemDom) => {
            const entityIdInput = entityItemDom.querySelector('.entity-id');
            if (!entityIdInput || !entityIdInput.value) return;

            const entityId = entityIdInput.value;
            const icon_size = entityItemDom.querySelector('.icon_size')?.value;
            const hours_to_show = entityItemDom.querySelector('.hours_to_show')?.value;
            const polyline_color = entityItemDom.querySelector('.polyline_color')?.value;
            const polyline_width = entityItemDom.querySelector('.polyline_width')?.value;
            const icon_color = entityItemDom.querySelector('.icon_color')?.value;
            const background_color = entityItemDom.querySelector('.background_color')?.value;
            const follow = entityItemDom.querySelector('.follow-entity')?.checked;
            const history_dot_size = entityItemDom.querySelector('.history_dot_size')?.value; // Yeni: Geçmiş nokta boyutu

            const entityObj = {
                entity: entityId
            };
            if (icon_size !== '' && !isNaN(parseFloat(icon_size))) entityObj.icon_size = parseFloat(icon_size);
            if (hours_to_show !== '' && !isNaN(parseFloat(hours_to_show))) entityObj.hours_to_show = parseFloat(hours_to_show);
            if (polyline_color) entityObj.polyline_color = polyline_color;
            if (polyline_width !== '' && !isNaN(parseFloat(polyline_width))) entityObj.polyline_width = parseFloat(polyline_width);
            if (icon_color) entityObj.icon_color = icon_color;
            if (background_color) entityObj.background_color = background_color;
            if (follow) entityObj.follow = true;
            if (history_dot_size !== '' && !isNaN(parseFloat(history_dot_size))) entityObj.history_dot_size = parseFloat(history_dot_size); // Yeni: Geçmiş nokta boyutu

            newEntities.push(entityObj);
        });

        if (newEntities.length > 0) {
            newConfig.entities = newEntities;
        }

        const managedKeys = [
            'type', 'api_key', 'zoom', 'theme_mode', 'aspect_ratio', 'map_type', 'entities',
            'showScale', 'keyboardShortcuts', 'cameraControl', 'zoomControl', 'streetViewControl',
            'fullscreenControl', 'mapTypeControl', 'rotateControl', 'cameraControl_position',
            'zoomControl_position', 'streetViewControl_position', 'fullscreenControl_position',
            'mapTypeControl_position', 'rotateControl_position'
        ];

        if (this._config) {
            for (const key in this._config) {
                if (Object.prototype.hasOwnProperty.call(this._config, key)) {
                    if (!managedKeys.includes(key)) {
                        newConfig[key] = this._config[key];
                    }
                }
            }
        }

        this._tmpConfig = newConfig;

        if (JSON.stringify(this._config) !== JSON.stringify(newConfig)) {
            this._config = newConfig;
            this.dispatchEvent(new CustomEvent('config-changed', {
                detail: {
                    config: newConfig
                },
                bubbles: true,
                composed: true
            }));
        }
    }

    _fillDefaultEntityValues(index) {}

    _restoreCollapseStates() {}

    getConfig() {
        return this._config;
    }
}

customElements.define('google-map-card-editor', GoogleMapCardEditor);

GoogleMapCard.getConfigElement = () => document.createElement('google-map-card-editor');

GoogleMapCard.getStubConfig = () => {
    return {
        type: 'custom:google-map-card',
        api_key: '',
        zoom: 11,
        entities: [],
        showScale: true,
        keyboardShortcuts: true,
        cameraControl: true,
        zoomControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        mapTypeControl: true,
        rotateControl: true,
        cameraControl_position: 'RIGHT_BOTTOM',
        zoomControl_position: 'RIGHT_BOTTOM',
        streetViewControl_position: 'LEFT_BOTTOM',
        fullscreenControl_position: 'TOP_RIGHT',
        mapTypeControl_position: 'TOP_LEFT',
        rotateControl_position: 'LEFT_BOTTOM',
    };
};

window.customCards = window.customCards || [];
window.customCards.push({
    type: 'google-map-card',
    name: 'Google Map Card',
    preview: true,
    description: 'Displays person/zone/device_tracker entity locations on Google Maps',
});
