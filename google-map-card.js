import { get_map_themes } from './themes.js';

class GoogleMapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.map = null;
    this.markers = [];
    // Changed polylines to a Map to store by entityId for easier updates
    this.polylines = new Map(); // Map<entityId, google.maps.Polyline>
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
        // New: polyline_width added with a default of 1
        polyline_width: typeof entityConfig.polyline_width === 'number' ? entityConfig.polyline_width : 1,
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
      // No need to clear polylines explicitly here, _updateMarkers will handle it
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
      // Only add a new history point if the location has changed significantly or enough time has passed.
      // This helps prevent adding duplicate points if the entity's state is frequently updated without movement.
      const latChanged = lastEntry ? Math.abs(lastEntry.lat - state.attributes.latitude) > 0.000001 : true;
      const lonChanged = lastEntry ? Math.abs(lastEntry.lon - state.attributes.longitude) > 0.000001 : true;
      const timePassed = lastEntry ? (new Date(state.last_updated).getTime() - lastEntry.timestamp) > 5000 : true; // Add point if 5 seconds passed

      if (!lastEntry || (latChanged || lonChanged || timePassed)) {
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
          polyline_width: entitySpecificConfig.polyline_width, // Pass polyline_width
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

  // Renamed and refactored to handle polyline updates
  _updatePolylines() {
    const polylinesToKeep = new Set();

    this.config.entities.forEach(entityConfig => {
        const eid = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
        const entitySpecificConfig = this.entityConfigs[eid];

        if (!entitySpecificConfig) return;

        const hoursToShowForEntity = entitySpecificConfig.hours_to_show;
        const polylineColorForEntity = entitySpecificConfig.polyline_color;
        const polylineWidthForEntity = entitySpecificConfig.polyline_width; // Get polyline width

        if (hoursToShowForEntity > 0) {
            const history = this.locationHistory[eid] || [];
            if (history.length >= 2) {
                const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
                const path = sortedHistory.map(point => new google.maps.LatLng(point.lat, point.lon));

                let polyline = this.polylines.get(eid);

                if (polyline) {
                    // Update existing polyline path and options
                    polyline.setPath(path);
                    polyline.setOptions({ 
                        strokeColor: polylineColorForEntity, 
                        strokeOpacity: 0.7, 
                        strokeWeight: polylineWidthForEntity // Use polylineWidthForEntity here
                    });
                } else {
                    // Create new polyline
                    polyline = new google.maps.Polyline({
                        path: path,
                        geodesic: true,
                        strokeColor: polylineColorForEntity,
                        strokeOpacity: 0.7,
                        strokeWeight: polylineWidthForEntity, // Use polylineWidthForEntity here
                        map: this.map
                    });
                    this.polylines.set(eid, polyline);
                }
                polylinesToKeep.add(eid);
            }
        }
    });

    // Remove polylines that are no longer needed
    this.polylines.forEach((polyline, eid) => {
        if (!polylinesToKeep.has(eid)) {
            polyline.setMap(null);
            this.polylines.delete(eid);
        }
    });
  }

  async _updateMarkers() {
    const existingMarkers = new Map(this.markers.map(m => [m.entityId, m]));
    
    const currentLocations = this._getCurrentLocations();
    if (currentLocations.length === 0 && Object.keys(this.locationHistory).every(key => this.locationHistory[key].length === 0)) {
        this._clearMarkers(true);
        this._updatePolylines(); // Ensure polylines are also cleared if no locations
        return;
    }

    const markersToKeep = new Set();
    const iconPromises = currentLocations.map(async loc => {
        const iconSizeForEntity = loc.icon_size;
        const iconColorForEntity = loc.icon_color;
        const backgroundColorForEntity = loc.background_color;
        
        // Define border size for icons (2px) and pictures (0px)
        const borderSizeForIcon = 2; 

        let markerIcon = null;
        let fullPictureUrl = null;
        let fullIconUrl = null;

        if (loc.picture) {
            fullPictureUrl = loc.picture.startsWith('/')
                ? `${window.location.origin}${loc.picture}`
                : loc.picture;
            // For pictures, pass borderSize as 0 and null for colors
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
                // For icons, apply iconColor and backgroundColor with border
                markerIcon = await this._createCircularIcon(fullIconUrl, iconSizeForEntity, borderSizeForIcon, iconColorForEntity, backgroundColorForEntity);
            } catch (e) {
                console.error('Error creating icon:', e);
                markerIcon = null;
            }
        }
        return { ...loc, markerIcon, fullPictureUrl, fullIconUrl };
    });

    const locationsWithIcons = await Promise.all(iconPromises);

    this.markers = []; // Re-initialize this.markers to only contain current active markers

    locationsWithIcons.forEach(loc => {
        let marker = existingMarkers.get(loc.id);

        if (marker) {
            marker.setPosition({ lat: loc.lat, lng: loc.lon });
            if (marker.getIcon() !== loc.markerIcon) {
                marker.setIcon(loc.markerIcon || null);
            }
            if (marker.infoWindow) {
                // Info window content, ensuring border-radius for pictures is applied correctly
                const infoContent = `
                <div style="text-align:center; padding:10px; min-width:120px;">
                  ${loc.picture ? `<img src="${loc.fullPictureUrl}" width="${loc.icon_size}" height="${loc.icon_size}" style="border-radius:50%;">` : 
                    loc.icon ? `<ha-icon icon="${loc.icon}" style="width:${loc.icon_size}px; height:${loc.icon_size}px; color: ${loc.icon_color}; background-color: ${loc.background_color}; border-radius: 50%;"></ha-icon>` : ''}
                  <div style="margin-top:8px;font-weight:bold;">${loc.name}</div>
                  <div style="font-size:0.9em;color:#666;">${loc.state}</div>
                </div>
                `;
                marker.infoWindow.setContent(infoContent);
            }
            markersToKeep.add(loc.id);
            this.markers.push(marker); // Add back to active markers
        } else {
            marker = new google.maps.Marker({
                position: { lat: loc.lat, lng: loc.lon },
                map: this.map,
                title: loc.name,
                icon: loc.markerIcon || null,
                optimized: true
            });
            marker.entityId = loc.id;

            // Info window content for new markers
            const infoContent = `
            <div style="text-align:center; padding:10px; min-width:120px;">
              ${loc.picture ? `<img src="${loc.fullPictureUrl}" width="${loc.icon_size}" height="${loc.icon_size}" style="border-radius:50%;">` : 
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
            this.markers.push(marker); // Add new marker to active markers
        }
    });

    // Remove markers that are no longer needed
    existingMarkers.forEach((marker, entityId) => {
        if (!markersToKeep.has(entityId)) {
            if (marker.infoWindow) marker.infoWindow.close();
            marker.setMap(null);
        }
    });

    // Call the updated polyline function
    this._updatePolylines();
  }

  async _createCircularIcon(imageUrl, size, borderSize = 0, iconColor = null, backgroundColor = null) {
    const canvas = document.createElement('canvas');
    
    const contentDiameter = size;
    const iconPadding = imageUrl.endsWith('.svg') ? 4 : 0; // 4px padding for icons, 0 for pictures
    const borderThickness = imageUrl.endsWith('.svg') ? borderSize : 0;

    const totalCanvasDiameter = contentDiameter + (2 * iconPadding) + (2 * borderThickness);
    canvas.width = totalCanvasDiameter;
    canvas.height = totalCanvasDiameter;
    const ctx = canvas.getContext('2d');

    // Clear the canvas to ensure transparency initially
    ctx.clearRect(0, 0, totalCanvasDiameter, totalCanvasDiameter);

    const centerX = totalCanvasDiameter / 2;
    const centerY = totalCanvasDiameter / 2;

    // Apply background color if it's an icon and a background is specified
    if (imageUrl.endsWith('.svg') && backgroundColor) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, totalCanvasDiameter / 2, 0, Math.PI * 2);
      ctx.fillStyle = backgroundColor;
      ctx.fill();
    }

    // Apply border if it's an icon and borderThickness > 0
    if (imageUrl.endsWith('.svg') && borderThickness > 0) {
      ctx.beginPath();
      // The border should be drawn around the content + inner padding area
      // Its radius extends up to the outer edge of the canvas, minus half its thickness
      ctx.arc(centerX, centerY, (totalCanvasDiameter - borderThickness) / 2, 0, Math.PI * 2); 
      ctx.strokeStyle = iconColor || '#000000'; // Default border color if iconColor not provided
      ctx.lineWidth = borderThickness; // Set stroke width to the border thickness
      ctx.stroke();
    }

    // Clip to a circle for the actual image/icon content.
    // This clipping circle's radius is half of the 'size' parameter (contentDiameter / 2), 
    // ensuring the content itself is the desired 'size' diameter.
    ctx.beginPath();
    ctx.arc(centerX, centerY, contentDiameter / 2, 0, Math.PI * 2);
    ctx.clip();

    // Calculate offset to draw the image/icon centered within the clipped area
    // This offset considers border and padding to correctly center the contentDiameter image
    const drawX = (totalCanvasDiameter - contentDiameter) / 2;
    const drawY = (totalCanvasDiameter - contentDiameter) / 2;

    if (imageUrl.endsWith('.svg')) {
      try {
        const response = await fetch(imageUrl);
        let svgText = await response.text();

        // Apply iconColor to SVG fill and stroke attributes if provided
        if (iconColor) {
            svgText = svgText.replace(/fill="[^"]*?"/g, `fill="${iconColor}"`);
            svgText = svgText.replace(/stroke="[^"]*?"/g, `stroke="${iconColor}"`);

            // Also check for style attribute to replace fill/stroke within it
            svgText = svgText.replace(/style="([^"]*?)(fill:[^;]*?;?|stroke:[^;]*?;?)"/g, (match, p1) => {
              let newStyle = p1.replace(/fill:[^;]*;?/g, `fill:${iconColor};`).replace(/stroke:[^;]*;?/g, `stroke:${iconColor};`);
              return `style="${newStyle}"`;
            });
            // If no fill/stroke attributes found, add a default fill to <path> elements
            if (!svgText.includes('fill=') && !svgText.includes('stroke=') && svgText.includes('<path')) {
                svgText = svgText.replace(/<path/g, `<path fill="${iconColor}"`);
            }
        }

        const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const newImageUrl = URL.createObjectURL(svgBlob);

        return new Promise((resolveInner) => {
          const image = new Image();
          image.onload = () => {
            // Draw the SVG image at the calculated offset and desired 'size'
            ctx.drawImage(image, drawX, drawY, contentDiameter, contentDiameter);
            URL.revokeObjectURL(newImageUrl);
            resolveInner({
              url: canvas.toDataURL(),
              scaledSize: new google.maps.Size(totalCanvasDiameter, totalCanvasDiameter),
              anchor: new google.maps.Point(totalCanvasDiameter/2, totalCanvasDiameter/2)
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
      // For non-SVG images (pictures)
      return new Promise((resolveInner) => {
        const image = new Image();
        image.crossOrigin = 'Anonymous'; // Needed for loading images from different origins on canvas
        image.onload = () => {
          // Draw the picture at the calculated offset and desired 'size'
          ctx.drawImage(image, drawX, drawY, contentDiameter, contentDiameter);
          resolveInner({
            url: canvas.toDataURL(),
            scaledSize: new google.maps.Size(totalCanvasDiameter, totalCanvasDiameter),
            anchor: new google.maps.Point(totalCanvasDiameter/2, totalCanvasDiameter/2)
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
      // Use defaults as placeholders if not explicitly set
      const iconSize = e.icon_size !== undefined ? e.icon_size : this._config.icon_size || 20;
      const entityHours = e.hours_to_show !== undefined ? e.hours_to_show : 0;
      const polylineColor = e.polyline_color || '#FFFFFF'; // Default color
      const polylineWidth = e.polyline_width !== undefined ? e.polyline_width : 1; // Default width
      const iconColor = e.icon_color || '#780202'; // Default color
      const backgroundColor = e.background_color || '#FFFFFF'; // Default color


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
              <div class="input-row-grid-three">
                <label class="font-resizer">Icon Size:
                  <input class="entity-input icon_size" type="text" data-index="${index}" value="${iconSize}" placeholder="e.g. 24" />
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
          </div>
        </div>
      `;
    }).join('');

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

        /* Yeni CSS kuralı: Belirtilen labellerin font boyutunu %85 oranında küçültür */
        .font-resizer {
            font-size: 85%;
        }

        .card-container {
          padding: 0px;
          border-radius: unset;
          box-shadow: none;
          max-width: 1000px; /* Increased max-width for wider layout */
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

        .input-row-grid-three { /* NEW CSS CLASS */
          display: grid;
          grid-template-columns: 1fr 1fr 1fr; /* Three equal columns */
          gap: 15px; /* Maintain consistent gap */
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
                <span class="icon">✨</span> Common Settings
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

    // New: Listener for entity-id input to fill default values
    this.shadowRoot.querySelectorAll('.entity-id').forEach(input => {
      input.addEventListener('change', (e) => this._fillDefaultEntityValues(e.target.dataset.index));
      input.addEventListener('keyup', debounce((e) => this._fillDefaultEntityValues(e.target.dataset.index), 300));
    });


    this.shadowRoot.getElementById('add_entity')?.addEventListener('click', () => {
      const updated = [...(this._tmpConfig.entities || [])];
      const newEntityIndex = updated.length; // Get the index of the new entity

      updated.push({ entity: '' });
      this._tmpConfig.entities = updated;

      // Set the collapse state for the newly added entity to false (uncollapsed)
      this._tmpConfig._editor_collapse_entity = { ...(this._tmpConfig._editor_collapse_entity || {}) };
      this._tmpConfig._editor_collapse_entity[newEntityIndex] = false; // Explicitly set to uncollapsed

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

  // New method to fill default values for entity-specific inputs
  _fillDefaultEntityValues(index) {
    const entityItemDom = this.shadowRoot.querySelector(`.entity-item[data-index="${index}"]`);
    if (!entityItemDom) return;

    const entityIdInput = entityItemDom.querySelector('.entity-id');
    const entityId = entityIdInput.value;

    if (entityId) {
      const currentEntityConfig = this._tmpConfig.entities[index] || {};

      // Get global defaults or internal defaults based on user's request
      const defaultIconSize = 20;
      const defaultHoursToShow = 0;
      const defaultPolylineColor = '#FFFFFF'; // Changed to White
      const defaultPolylineWidth = 1;
      const defaultIconColor = '#FF0000'; // Changed to Red
      const defaultBackgroundColor = '#FFFFFF'; // Changed to White

      // Fill if the field is empty in the current config object
      if (currentEntityConfig.icon_size === undefined) currentEntityConfig.icon_size = defaultIconSize;
      if (currentEntityConfig.hours_to_show === undefined) currentEntityConfig.hours_to_show = defaultHoursToShow;
      if (currentEntityConfig.polyline_color === undefined) currentEntityConfig.polyline_color = defaultPolylineColor;
      if (currentEntityConfig.polyline_width === undefined) currentEntityConfig.polyline_width = defaultPolylineWidth;
      if (currentEntityConfig.icon_color === undefined) currentEntityConfig.icon_color = defaultIconColor;
      if (currentEntityConfig.background_color === undefined) currentEntityConfig.background_color = defaultBackgroundColor;
      
      this._tmpConfig.entities[index] = currentEntityConfig;
      this._render(); // Re-render to show updated default values in inputs
      this._valueChanged(); // Trigger config change
    }
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
        const polyline_width = entityItemDom.querySelector('.polyline_width')?.value; 
        const icon_color = entityItemDom.querySelector('.icon_color')?.value;
        const background_color = entityItemDom.querySelector('.background_color')?.value;

        const entityObj = { entity: entityId };
        if (icon_size !== '' && !isNaN(parseFloat(icon_size))) entityObj.icon_size = parseFloat(icon_size);
        if (hours_to_show !== '' && !isNaN(parseFloat(hours_to_show))) entityObj.hours_to_show = parseFloat(hours_to_show);
        if (polyline_color) entityObj.polyline_color = polyline_color;
        // Check if polyline_width is a valid number before assigning
        if (polyline_width !== '' && !isNaN(parseFloat(polyline_width))) entityObj.polyline_width = parseFloat(polyline_width);
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
    };

    // Remove internal editor-specific properties before dispatching the config
    Object.keys(newConfig).forEach(key => newConfig[key] === undefined && delete newConfig[key]);
    if (newConfig._editor_collapse_appearance !== undefined) {
        delete newConfig._editor_collapse_appearance;
    }
    if (newConfig._editor_collapse_entity !== undefined) {
        delete newConfig._editor_collapse_entity;
    }
    // Assuming 'grid_options' might be added globally if implemented later
    if (newConfig.grid_options !== undefined) { 
        delete newConfig.grid_options;
    }

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
