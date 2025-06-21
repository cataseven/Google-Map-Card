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
    this.darkModeStyles = [
      {elementType: "geometry", stylers: [{color: "#242f3e"}]},
      {elementType: "labels.text.stroke", stylers: [{color: "#242f3e"}]},
      {elementType: "labels.text.fill", stylers: [{color: "#746855"}]},
      {
        featureType: "administrative.locality",
        elementType: "labels.text.fill",
        stylers: [{color: "#d59563"}]
      },
      {
        featureType: "poi",
        elementType: "labels.text.fill",
        stylers: [{color: "#d59563"}]
      },
      {
        featureType: "poi.park",
        elementType: "geometry",
        stylers: [{color: "#263c3f"}]
      },
      {
        featureType: "poi.park",
        elementType: "labels.text.fill",
        stylers: [{color: "#6b9a76"}]
      },
      {
        featureType: "road",
        elementType: "geometry",
        stylers: [{color: "#38414e"}]
      },
      {
        featureType: "road",
        elementType: "geometry.stroke",
        stylers: [{color: "#212a37"}]
      },
      {
        featureType: "road",
        elementType: "labels.text.fill",
        stylers: [{color: "#9ca5b3"}]
      },
      {
        featureType: "road.highway",
        elementType: "geometry",
        stylers: [{color: "#746855"}]
      },
      {
        featureType: "road.highway",
        elementType: "geometry.stroke",
        stylers: [{color: "#1f2835"}]
      },
      {
        featureType: "road.highway",
        elementType: "labels.text.fill",
        stylers: [{color: "#f3d19c"}]
      },
      {
        featureType: "transit",
        elementType: "geometry",
        stylers: [{color: "#2f3948"}]
      },
      {
        featureType: "transit.station",
        elementType: "labels.text.fill",
        stylers: [{color: "#d59563"}]
      },
      {
        featureType: "water",
        elementType: "geometry",
        stylers: [{color: "#17263c"}]
      },
      {
        featureType: "water",
        elementType: "labels.text.fill",
        stylers: [{color: "#515c6d"}]
      },
      {
        featureType: "water",
        elementType: "labels.text.stroke",
        stylers: [{color: "#17263c"}]
      }
    ];
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
    this.config = config;
    this.zoom = config.zoom || 11;
    this.themeMode = config.theme_mode || 'light';
    this.aspectRatio = config.aspect_ratio || null; 

    this.globalIconSize = config.icon_size || 20;
    this.globalPictureSize = config.picture_size || config.icon_size || 20;
    this.globalHoursToShow = typeof config.hours_to_show === 'number' ? config.hours_to_show : 0;
    this.globalIconColor = config.icon_color || '#03A9F4';
    this.globalBackgroundColor = config.background_color || '#FFFFFF';

    this.entityConfigs = {};
    this.config.entities.forEach(entityConfig => {
      const entityId = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
      this.entityConfigs[entityId] = {
        polyline_color: entityConfig.polyline_color || '#0000FF',
        icon_size: entityConfig.icon_size || this.globalIconSize,
        picture_size: entityConfig.picture_size || this.globalPictureSize,
        hours_to_show: typeof entityConfig.hours_to_show === 'number' ? entityConfig.hours_to_show : this.globalHoursToShow,
        icon_color: entityConfig.icon_color || this.globalIconColor,
        background_color: entityConfig.background_color || this.globalBackgroundColor,
      };
    });
  }

  set hass(hass) {
    this._hass = hass;
    if (this.apiKeyLoaded && this.map) {
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
        mapClasses = 'aspect-ratio-container'; // İçerik pozisyonlaması için sınıf
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
          overflow: hidden; /* Border-radius ile içerik taşmasını engelle */
        }
        /* Eğer aspect_ratio kullanılıyorsa, asıl harita div'inin içindeki içeriği kaplaması için */
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
    if (locations.length === 0) {
      mapEl.innerHTML = `<p>No location data available for the configured entities.</p>`;
      this._clearMarkers();
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

      if (this.themeMode === 'dark') {
        mapOptions.styles = this.darkModeStyles;
      }

      this.map = new google.maps.Map(mapEl, mapOptions);
      this.firstDraw = false;
    }

    await this._updateMarkers();
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
          lastEntry.lon !== state.attributes.longitude) {
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
          picture_size: entitySpecificConfig.picture_size,
          polyline_color: entitySpecificConfig.polyline_color,
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
    this._clearMarkers();
    this._clearPolylines();

    const currentLocations = this._getCurrentLocations();
    if (currentLocations.length === 0) return;

    const iconPromises = currentLocations.map(async loc => {
      const iconSizeForEntity = loc.icon_size;
      const pictureSizeForEntity = loc.picture_size;
      const iconColorForEntity = loc.icon_color;
      const backgroundColorForEntity = loc.background_color;
      const borderSize = 2;

      if (loc.picture) {
        loc.fullPictureUrl = loc.picture.startsWith('/')
          ? `${window.location.origin}${loc.picture}`
          : loc.picture;
        loc.markerIcon = await this._createCircularIcon(loc.fullPictureUrl, pictureSizeForEntity, borderSize, null, backgroundColorForEntity);
      } else if (loc.icon) {
        try {
          const iconParts = loc.icon.split(':');
          const iconPrefix = iconParts[0];
          const iconName = iconParts[1];

          if (iconPrefix === 'mdi') {
            loc.fullIconUrl = `https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/${iconName}.svg`;
          } else {
            loc.fullIconUrl = `${this._hass.connection.baseUrl}/static/icons/${loc.icon.replace(':', '-')}.png`;
          }

          loc.markerIcon = await this._createCircularIcon(loc.fullIconUrl, iconSizeForEntity, borderSize, iconColorForEntity, backgroundColorForEntity);
        } catch (e) {
          console.error('Error creating icon:', e);
          loc.markerIcon = null;
        }
      }
      return loc;
    });

    const locationsWithIcons = await Promise.all(iconPromises);

    locationsWithIcons.forEach(loc => {
      const marker = new google.maps.Marker({
        position: { lat: loc.lat, lng: loc.lon },
        map: this.map,
        title: loc.name,
        icon: loc.markerIcon || null,
        optimized: true
      });

      const infoContent = `
        <div style="text-align:center; padding:10px; min-width:120px;">
          ${loc.picture ? `<img src="${loc.fullPictureUrl}" width="${loc.picture_size}" height="${loc.picture_size}" style="border-radius:50%;border:2px solid ${loc.background_color};box-shadow:0 2px 4px rgba(0,0,0,0.2);">` :
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

      this.markers.push(marker);
    });

    if (this.globalHoursToShow > 0 || this.config.entities.some(e => typeof e !== 'string' && typeof e.hours_to_show === 'number' && e.hours_to_show > 0)) {
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

  /**
   * @param {string} imageUrl
   * @param {number} size
   * @param {number} borderSize
   * @param {string} [iconColor=null]
   * @param {string} [backgroundColor=null]
   * @returns {Promise<google.maps.Icon|null>}
   */
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

  _clearMarkers() {
    this.markers.forEach(marker => {
      if (marker.infoWindow) marker.infoWindow.close();
      marker.setMap(null);
    });
    this.markers = [];
  }

  getCardSize() {
    return 4; 
  }
}

customElements.define('google-map-card', GoogleMapCard);
