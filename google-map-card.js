import { get_map_themes } from './themes.js';

class GoogleMapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.map = null;
    this.markers = [];
    this.polylines = [];
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
    this.themeName = config.theme_mode || 'Dark_Blueish_Night';
    this.aspectRatio = config.aspect_ratio || null;
    this.selectedThemeStyles = [];
    for (const mode in this.allThemes) {
      if (this.allThemes[mode][this.themeName]) {
        this.selectedThemeStyles = this.allThemes[mode][this.themeName];
        break;
      }
    }

    this.globalIconSize = config.icon_size || 20; 
    this.globalIconColor = config.icon_color || '#03A9F4';
    this.globalBackgroundColor = config.background_color || '#FFFFFF';

    this.entityConfigs = {};
    this.config.entities.forEach(entityConfig => {
      const entityId = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
      this.entityConfigs[entityId] = {
        polyline_color: entityConfig.polyline_color || '#0000FF',
        icon_size: entityConfig.icon_size || this.globalIconSize,
        hours_to_show: typeof entityConfig.hours_to_show === 'number' ? entityConfig.hours_to_show : 0,
        icon_color: entityConfig.icon_color || this.globalIconColor,
        background_color: entityConfig.background_color || this.globalBackgroundColor,
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
    if (window.google && window.google.maps) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${this.config.api_key}&libraries=geometry`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Maps script'));
      document.head.appendChild(script);
    });
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
      this._clearPolylines();
      return;
    }

    const loading = this.shadowRoot.querySelector('.loading');
    if (loading) loading.remove();

    if (this.firstDraw) {
      const avgLat = locations.reduce((sum, loc) => sum + loc.lat, 0) / locations.length;
      const avgLon = locations.reduce((sum, loc) => sum + loc.lon, 0) / locations.length;

      const mapOptions = {
        center: { lat: avgLat, lng: avgLon },
        zoom: this.zoom,
        mapTypeId: 'roadmap'
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

  async _loadAllInitialHistory() {
    this.locationHistory = {};
    const promises = this.config.entities.map(async entityConfig => {
        const eid = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
        const entitySpecificConfig = this.entityConfigs[eid];
        if (entitySpecificConfig && entitySpecificConfig.hours_to_show > 0) {
            const history = await this._loadHistoryForEntity(eid, entitySpecificConfig.hours_to_show);
            this.locationHistory[eid] = history;
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
      if (!lastEntry ||
          lastEntry.lat !== state.attributes.latitude ||
          lastEntry.lon !== state.attributes.longitude ||
          Math.abs(lastEntry.timestamp - new Date(state.last_updated).getTime()) > 1000
          ) {
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

  _clearPolylines() {
    this.polylines.forEach(polyline => polyline.setMap(null));
    this.polylines = [];
  }

  async _updateMarkers() {
    const existingMarkers = new Map(this.markers.map(m => [m.entityId, m]));
    this._clearPolylines();

    const currentLocations = this._getCurrentLocations();
    if (currentLocations.length === 0 && Object.keys(this.locationHistory).every(key => this.locationHistory[key].length === 0)) {
        this._clearMarkers(true);
        return;
    }

    const markersToKeep = new Set();
    const iconPromises = currentLocations.map(async loc => {
        const iconSizeForEntity = loc.icon_size;
        const iconColorForEntity = loc.icon_color;
        const backgroundColorForEntity = loc.background_color;
        const borderSize = 2;

        let markerIcon = null;
        let fullPictureUrl = null;
        let fullIconUrl = null;

        if (loc.picture) {
            fullPictureUrl = loc.picture.startsWith('/')
                ? `${window.location.origin}${loc.picture}`
                : loc.picture;
            markerIcon = await this._createCircularIcon(fullPictureUrl, iconSizeForEntity, borderSize, null, backgroundColorForEntity);
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
                markerIcon = await this._createCircularIcon(fullIconUrl, iconSizeForEntity, borderSize, iconColorForEntity, backgroundColorForEntity);
            } catch (e) {
                console.error('Error creating icon:', e);
                markerIcon = null;
            }
        }
        return { ...loc, markerIcon, fullPictureUrl, fullIconUrl };
    });

    const locationsWithIcons = await Promise.all(iconPromises);

    this.markers = [];

    locationsWithIcons.forEach(loc => {
        let marker = existingMarkers.get(loc.id);

        if (marker) {
            marker.setPosition({ lat: loc.lat, lng: loc.lon });
            if (marker.getIcon() !== loc.markerIcon) {
                marker.setIcon(loc.markerIcon || null);
            }
            if (marker.infoWindow) {
                const infoContent = `
                <div style="text-align:center; padding:10px; min-width:120px;">
                  ${loc.picture ? `<img src="${loc.fullPictureUrl}" width="${loc.icon_size}" height="${loc.icon_size}" style="border-radius:50%;border:2px solid ${loc.background_color};box-shadow:0 2px 4px rgba(0,0,0,0.2);">` :
                    loc.icon ? `<ha-icon icon="${loc.icon}" style="width:${loc.icon_size}px; height:${loc.icon_size}px; color: ${loc.icon_color}; background-color: ${loc.background_color}; border-radius: 50%;"></ha-icon>` : ''}
                  <div style="margin-top:8px;font-weight:bold;">${loc.name}</div>
                  <div style="font-size:0.9em;color:#666;">${loc.state}</div>
                </div>
                `;
                marker.infoWindow.setContent(infoContent);
            }
            markersToKeep.add(loc.id);
        } else {
            marker = new google.maps.Marker({
                position: { lat: loc.lat, lng: loc.lon },
                map: this.map,
                title: loc.name,
                icon: loc.markerIcon || null,
                optimized: true
            });
            marker.entityId = loc.id;

            const infoContent = `
            <div style="text-align:center; padding:10px; min-width:120px;">
              ${loc.picture ? `<img src="${loc.fullPictureUrl}" width="${loc.icon_size}" height="${loc.icon_size}" style="border-radius:50%;border:2px solid ${loc.background_color};box-shadow:0 2px 4px rgba(0,0,0,0.2);">` :
                loc.icon ? `<ha-icon icon="${loc.icon}" style="width:${loc.icon_size}px; height:${loc.icon_size}px; color: ${loc.icon_color}; background-color: ${loc.background_color}; border-radius: 50%;"></ha-icon>` : ''}
              <div style="margin-top:8px;font-weight:bold;">${loc.name}</div>
              <div style="font-size:0.9em;color:#666;">${loc.state}</div>
            </div>
            `;

            const infoWindow = new google.maps.InfoWindow({
                content: infoContent
            });

            marker.addListener('click', () => {
                this.markers.forEach(m => {
                    if (m.infoWindow) m.infoWindow.close();
                });
                infoWindow.open(this.map, marker);
                marker.infoWindow = infoWindow;
            });
            markersToKeep.add(loc.id);
        }
        this.markers.push(marker);
    });

    existingMarkers.forEach((marker, entityId) => {
        if (!markersToKeep.has(entityId)) {
            if (marker.infoWindow) marker.infoWindow.close();
            marker.setMap(null);
        }
    });


    if (this.config.entities.some(e => typeof e !== 'string' && typeof e.hours_to_show === 'number' && e.hours_to_show > 0)) {
        this.config.entities.forEach(entityConfig => {
            const eid = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
            const entitySpecificConfig = this.entityConfigs[eid];

            if (!entitySpecificConfig) return;

            const hoursToShowForEntity = entitySpecificConfig.hours_to_show;
            const polylineColorForEntity = entitySpecificConfig.polyline_color;

            if (hoursToShowForEntity > 0) {
                const history = this.locationHistory[eid] || [];
                if (history.length < 2) return;

                const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
                const path = sortedHistory.map(point => new google.maps.LatLng(point.lat, point.lon));

                const polyline = new google.maps.Polyline({
                    path: path,
                    geodesic: true,
                    strokeColor: polylineColorForEntity,
                    strokeOpacity: 0.7,
                    strokeWeight: 4,
                    map: this.map
                });

                this.polylines.push(polyline);
            }
        });
    }
  }

  async _createCircularIcon(imageUrl, size, borderSize = 2, iconColor = null, backgroundColor = null) {
    const canvas = document.createElement('canvas');
    const totalSize = size + borderSize * 2;
    canvas.width = totalSize;
    canvas.height = totalSize;
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.arc(totalSize/2, totalSize/2, totalSize/2, 0, Math.PI * 2);
    ctx.fillStyle = backgroundColor || 'white';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(totalSize/2, totalSize/2, size/2, 0, Math.PI * 2);
    ctx.clip();

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

        const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const newImageUrl = URL.createObjectURL(svgBlob);

        return new Promise((resolveInner) => {
          const image = new Image();
          image.onload = () => {
            ctx.drawImage(image, borderSize, borderSize, size, size);
            URL.revokeObjectURL(newImageUrl);
            resolveInner({
              url: canvas.toDataURL(),
              scaledSize: new google.maps.Size(totalSize, totalSize),
              anchor: new google.maps.Point(totalSize/2, totalSize/2)
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
          ctx.drawImage(image, borderSize, borderSize, size, size);
          resolveInner({
            url: canvas.toDataURL(),
            scaledSize: new google.maps.Size(totalSize, totalSize),
            anchor: new google.maps.Point(totalSize/2, totalSize/2)
          });
        };
        image.onerror = () => {
          console.warn('Failed to load image for marker:', imageUrl);
          resolveInner(null);
        };
        image.src = imageUrl;
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
    this.attachShadow({ mode: 'open' });
    this.themes = get_map_themes();
    this._debounceTimeout = null;
  }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config)); 
    this._tmpConfig = JSON.parse(JSON.stringify(config));
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._updateEntityDatalist();
  }

  get _entities() {
    return this._tmpConfig.entities || [];
  }

  _getEntitiesForDatalist() {
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

  _updateEntityDatalist() {
    const datalist = this.shadowRoot.getElementById('ha-entities');
    if (datalist) {
      const entityOptions = this._getEntitiesForDatalist()
        .map(entityId => `<option value="${entityId}">`).join('');
      datalist.innerHTML = entityOptions;
    }
  }

  _render() {
    const activeElement = this.shadowRoot.activeElement;
    let activeEntityIndex = -1;
    let activeInputClass = '';
    let cursorStart = -1;
    let cursorEnd = -1;

    if (activeElement && activeElement.closest('.entity-item')) {
        activeEntityIndex = parseInt(activeElement.closest('.entity-item').dataset.index);
        activeInputClass = Array.from(activeElement.classList).find(cls => cls.includes('input'));
        cursorStart = activeElement.selectionStart;
        cursorEnd = activeElement.selectionEnd;
    }

    const theme = this._tmpConfig.theme_mode || 'Auto';
    const aspect = this._tmpConfig.aspect_ratio || '';
    const zoom = this._tmpConfig.zoom || 11;
    const apiKey = this._tmpConfig.api_key || '';

    const allThemes = Object.keys(this.themes['dark'] || {}).concat(Object.keys(this.themes['light'] || {}));
    const uniqueThemes = [...new Set(allThemes)].sort();
    const themeOptions = ['Auto', ...uniqueThemes]
      .map(t => `<option value="${t}" ${t === theme ? 'selected' : ''}>${t}</option>`).join('');

    const entityOptions = this._getEntitiesForDatalist()
      .map(entityId => `<option value="${entityId}">`).join('');

    let entitiesHtml = this._entities.map((e, index) => {
      const entityId = typeof e === 'string' ? e : e.entity;
      const iconSize = e.icon_size || '';
      const entityHours = e.hours_to_show ?? '';
      const polylineColor = e.polyline_color || '';
      const iconColor = e.icon_color || '';
      const backgroundColor = e.background_color || '';

      const isCollapsed = this._tmpConfig._editor_collapse_entity && this._tmpConfig._editor_collapse_entity[index];
      const collapsedClass = isCollapsed ? 'collapsed' : '';
      const arrowDirection = isCollapsed ? '►' : '▼';

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
                <input class="entity-input entity-id" data-index="${index}" value="${entityId}" placeholder="e.g. device_tracker.john_doe" list="ha-entities" />
              </label>
              <div class="input-row-grid">
                <label>Icon Size:
                  <input class="entity-input icon_size" type="text" data-index="${index}" value="${iconSize}" placeholder="e.g. 24" />
                </label>
                    <label>Polyline Color:
                  <input class="entity-input polyline_color" type="color" data-index="${index}" value="${polylineColor}" />
                </label>
              </div>
              <div class="input-row-grid">
                <label>Icon Color:
                  <input class="entity-input icon_color" type="color" data-index="${index}" value="${iconColor}" />
                </label>
                <label>Background Color:
                  <input class="entity-input background_color" type="color" data-index="${index}" value="${backgroundColor}" />
                </label>
              </div>
              <label>Hours to Show (Entity Specific):
                  <input class="entity-input hours_to_show" type="text" data-index="${index}" value="${entityHours}" placeholder="e.g. 24" />
              </label>
          </div>
        </div>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 20px;
          --select-arrow-color: var(--secondary-text-color, #888);
          font-family: var(--primary-font-family);
        }
        
        label, input, select, button, .section-title, .entity-name {
          font-family: var(--primary-font-family);
        }

        .card-container {
          padding: 20px;
          border-radius: unset;
          box-shadow: none;
          max-width: 800px;
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

        .input-row-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }
        
        .input-row-grid label {
          margin-top: 0;
          margin-bottom: 0;
        }
        
        .input-row-grid input,
        .input-row-grid select {
          margin-bottom: 0;
        }

        .entity-list-container {
          margin-top: 20px;
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
        
        .entity-header .action-icon:hover {
          opacity: 0.8;
        }
        
        .entity-header .action-icon.dropdown-arrow {
          transition: transform 0.2s ease-in-out;
          line-height: 1;
        }
        
        .entity-details {
          padding: 15px;
          border-radius: unset;
          background-color: var(--card-background-color);
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
          margin-bottom: 10px;
          margin-top: 20px;
          color: var(--primary-text-color);
        }
      </style>
      <div class="card-container">
        <div>
            <div class="section-header" id="appearance-header">
                <span class="icon">✨</span> Appearance
                <span class="arrow">▼</span>
            </div>
            <div class="section-content" id="appearance-content">
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
                    </div>
                <label>API Key:
                    <input id="api_key" value="${apiKey}" placeholder="Your Google Maps API Key" type="text" />
                </label>
            </div>

            <div class="section-title">Entities (required)</div>
            <div class="entity-list-container">
                ${entitiesHtml}
            </div>
            <button id="add_entity">➕ Add Entity</button>
        </div>
      </div>
      <datalist id="ha-entities">
        ${entityOptions}
      </datalist>
    `;

    this._attachListeners();
    this._restoreCollapseStates();
    
    if (activeElement && activeElement.closest('.entity-item')) {
        const newActiveElement = this.shadowRoot.querySelector(`.entity-item[data-index="${activeEntityIndex}"] .${activeInputClass}`);
        if (newActiveElement) {
            newActiveElement.focus();
            newActiveElement.setSelectionRange(cursorStart, cursorEnd);
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

    this.shadowRoot.getElementById('api_key')?.addEventListener('change', () => this._valueChanged());
    this.shadowRoot.getElementById('api_key')?.addEventListener('keyup', debounce(() => this._valueChanged(), 750));
    this.shadowRoot.getElementById('zoom')?.addEventListener('change', () => this._valueChanged());
    this.shadowRoot.getElementById('zoom')?.addEventListener('keyup', debounce(() => this._valueChanged(), 750));
    this.shadowRoot.getElementById('theme_mode')?.addEventListener('change', () => this._valueChanged());
    this.shadowRoot.getElementById('aspect_ratio')?.addEventListener('change', () => this._valueChanged());
    this.shadowRoot.getElementById('aspect_ratio')?.addEventListener('keyup', debounce(() => this._valueChanged(), 750));


    this.shadowRoot.querySelectorAll('.entity-input').forEach(input => {
        input.addEventListener('change', () => this._valueChanged());
        if (input.type === 'text' || input.type === 'number') {
            input.addEventListener('keyup', debounce(() => this._valueChanged(), 500));
        }
    });

    this.shadowRoot.getElementById('add_entity')?.addEventListener('click', () => {
      const updated = [...(this._tmpConfig.entities || [])];
      updated.push({ entity: '' });
      this._tmpConfig.entities = updated; 
      this._render();
      this._valueChanged();
    });


    this.shadowRoot.querySelectorAll('.entity-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.classList.contains('action-icon')) {
            return;
        }
        const entityItem = header.closest('.entity-item');
        if (entityItem) {
            entityItem.classList.toggle('collapsed');
            const index = parseInt(entityItem.dataset.index);
            this._tmpConfig._editor_collapse_entity = { ...(this._tmpConfig._editor_collapse_entity || {}) };
            this._tmpConfig._editor_collapse_entity[index] = entityItem.classList.contains('collapsed');
            const arrowSpan = header.querySelector('.dropdown-arrow');
            if (arrowSpan) {
                arrowSpan.textContent = entityItem.classList.contains('collapsed') ? '►' : '▼';
            }
            this._valueChanged();
        }
      });
    });

    this.shadowRoot.querySelectorAll('.delete-entity').forEach(button => {
      button.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        if (!isNaN(index)) {
          const currentEntities = [...(this._tmpConfig.entities || [])];
          currentEntities.splice(index, 1);

          let newCollapseStates = { ...(this._tmpConfig._editor_collapse_entity || {}) };
          if (this._tmpConfig._editor_collapse_entity) {
              const tempCollapseStates = {}; 
              Object.keys(newCollapseStates).forEach(key => {
                  const oldIndex = parseInt(key);
                  if (oldIndex < index) {
                      tempCollapseStates[oldIndex] = newCollapseStates[oldIndex];
                  } else if (oldIndex > index) {
                      tempCollapseStates[oldIndex - 1] = newCollapseStates[oldIndex];
                  }
              });
              newCollapseStates = tempCollapseStates; 
          }
          
          const newTmpConfig = {
              ...this._tmpConfig, 
              entities: currentEntities.length > 0 ? currentEntities : undefined, 
              _editor_collapse_entity: newCollapseStates 
          };
          
          if (newTmpConfig.entities && newTmpConfig.entities.length === 0) {
              delete newTmpConfig.entities;
          }

          this._tmpConfig = newTmpConfig;

          this._render();
          this._valueChanged();
        }
      });
    });

    this.shadowRoot.getElementById('appearance-header')?.addEventListener('click', () => {
      const header = this.shadowRoot.getElementById('appearance-header');
      const content = this.shadowRoot.getElementById('appearance-content');
      if (header && content) {
          header.classList.toggle('collapsed');
          content.classList.toggle('hidden');
          this._tmpConfig._editor_collapse_appearance = header.classList.contains('collapsed');
          this._valueChanged();
      }
    });
  }

  _restoreCollapseStates() {
    const appearanceHeader = this.shadowRoot.getElementById('appearance-header');
    const appearanceContent = this.shadowRoot.getElementById('appearance-content');
    if (this._tmpConfig._editor_collapse_appearance && appearanceHeader && appearanceContent) {
        appearanceHeader.classList.add('collapsed');
        appearanceContent.classList.add('hidden');
    }

    if (this._tmpConfig._editor_collapse_entity) {
        this.shadowRoot.querySelectorAll('.entity-item').forEach(entityItem => {
            const index = parseInt(entityItem.dataset.index);
            if (this._tmpConfig._editor_collapse_entity[index]) {
                entityItem.classList.add('collapsed');
                const arrowSpan = entityItem.querySelector('.dropdown-arrow');
                if (arrowSpan) {
                    arrowSpan.textContent = '►';
                }
            }
        });
    }
  }

  _valueChanged() {
    const apiKey = this.shadowRoot.getElementById('api_key').value;
    const zoom = parseFloat(this.shadowRoot.getElementById('zoom').value);
    const theme = this.shadowRoot.getElementById('theme_mode').value;
    const aspect = this.shadowRoot.getElementById('aspect_ratio').value;

    const newEntities = [];
    this.shadowRoot.querySelectorAll('.entity-item').forEach((entityItemDom, index) => {
        const entityIdInput = entityItemDom.querySelector('.entity-id');
        if (!entityIdInput || !entityIdInput.value) {
            return; 
        }

        const entityId = entityIdInput.value;
        const icon_size = entityItemDom.querySelector('.icon_size')?.value;
        const hours_to_show = entityItemDom.querySelector('.hours_to_show')?.value;
        const polyline_color = entityItemDom.querySelector('.polyline_color')?.value;
        const icon_color = entityItemDom.querySelector('.icon_color')?.value;
        const background_color = entityItemDom.querySelector('.background_color')?.value;

        const entityObj = { entity: entityId };
        if (icon_size !== '' && !isNaN(parseFloat(icon_size))) entityObj.icon_size = parseFloat(icon_size);
        if (hours_to_show !== '' && !isNaN(parseFloat(hours_to_show))) entityObj.hours_to_show = parseFloat(hours_to_show);
        if (polyline_color) entityObj.polyline_color = polyline_color;
        if (icon_color) entityObj.icon_color = icon_color;
        if (background_color) entityObj.background_color = background_color;
        
        newEntities.push(entityObj);
    });

    const newConfig = {
      type: 'custom:google-map-card',
      api_key: apiKey || undefined,
      zoom: isNaN(zoom) ? undefined : zoom,
      theme_mode: theme === 'Auto' ? undefined : theme,
      aspect_ratio: aspect || undefined,
      entities: newEntities.length > 0 ? newEntities : undefined,
      _editor_collapse_appearance: this._tmpConfig._editor_collapse_appearance,
      _editor_collapse_entity: this._tmpConfig._editor_collapse_entity,
    };

    Object.keys(newConfig).forEach(key => newConfig[key] === undefined && delete newConfig[key]);

    if (JSON.stringify(this._config) !== JSON.stringify(newConfig)) {
      this._config = newConfig;
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: newConfig },
        bubbles: true,
        composed: true
      }));
    }
  }

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
  };
};

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'google-map-card',
  name: 'Google Map Card',
  preview: true,
  description: 'Displays person/zone/device_tracker entity locations on Google Maps',
});
