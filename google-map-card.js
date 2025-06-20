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
    this.zoom = config.zoom || 15;
    this.iconSize = config.icon_size || 40;
    this.themeMode = config.theme_mode || 'light';
    this.hoursToShow = typeof config.hours_to_show === 'number' ? 
                       config.hours_to_show : 
                       4;
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
      script.src = `https://maps.googleapis.com/maps/api/js?key=${this.config.api_key}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Maps script'));
      document.head.appendChild(script);
    });
  }

  _initialRender() {
    const style = `
      <style>
        #map {
          width: 100%;
          height: 350px;
          border-radius: 8px;
          min-width: 300px;
          min-height: 350px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1);
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
        }
      </style>
    `;

    this.shadowRoot.innerHTML = `
      ${style}
      <div id="map">
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
      mapEl.innerHTML = `<p>No location data.</p>`;
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
    const cutoff = this.hoursToShow > 0 ? 
      now.getTime() - this.hoursToShow * 3600 * 1000 : 
      Number.MAX_SAFE_INTEGER;

    this.config.entities.forEach(eid => {
      const state = this._hass.states[eid];
      if (!state || !state.attributes.latitude || !state.attributes.longitude) return;

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
      .map(eid => this._hass.states[eid])
      .filter(s => s && s.attributes.latitude && s.attributes.longitude)
      .map(s => ({
        id: s.entity_id,
        name: s.attributes.friendly_name || s.entity_id,
        lat: s.attributes.latitude,
        lon: s.attributes.longitude,
        picture: s.attributes.entity_picture,
        state: s.state
      }));
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

    const size = this.iconSize;
    const borderSize = 2;

    const iconPromises = currentLocations.map(async loc => {
      if (loc.picture) {
        loc.fullPictureUrl = loc.picture.startsWith('/') 
          ? `${window.location.origin}${loc.picture}`
          : loc.picture;
        
        loc.icon = await this._createCircularIcon(loc.fullPictureUrl, size, borderSize);
      }
      return loc;
    });

    const locationsWithIcons = await Promise.all(iconPromises);

    locationsWithIcons.forEach(loc => {
      const marker = new google.maps.Marker({
        position: { lat: loc.lat, lng: loc.lon },
        map: this.map,
        title: loc.name,
        icon: loc.icon || null,
        optimized: true
      });

      const infoContent = `
        <div style="text-align:center; padding:10px; min-width:120px;">
          ${loc.picture ? `<img src="${loc.fullPictureUrl}" width="${size}" height="${size}" style="border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.2);">` : ''}
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

    if (this.hoursToShow > 0) {
      this.config.entities.forEach(eid => {
        const history = this.locationHistory[eid] || [];
        if (history.length < 2) return;

        const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
        const path = sortedHistory.map(point => new google.maps.LatLng(point.lat, point.lon));
        
        const polyline = new google.maps.Polyline({
          path: path,
          geodesic: true,
          strokeColor: '#0000FF',
          strokeOpacity: 0.7,
          strokeWeight: 4,
          map: this.map
        });

        this.polylines.push(polyline);
      });
    }
  }

  _createCircularIcon(imageUrl, size, borderSize = 2) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const totalSize = size + borderSize * 2;
      canvas.width = totalSize;
      canvas.height = totalSize;
      const ctx = canvas.getContext('2d');

      const image = new Image();
      image.crossOrigin = 'Anonymous';
      image.src = imageUrl;
      
      image.onload = () => {
        ctx.beginPath();
        ctx.arc(totalSize/2, totalSize/2, totalSize/2, 0, Math.PI * 2);
        ctx.fillStyle = 'white';
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(totalSize/2, totalSize/2, size/2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(image, borderSize, borderSize, size, size);
        
        resolve({
          url: canvas.toDataURL(),
          scaledSize: new google.maps.Size(totalSize, totalSize),
          anchor: new google.maps.Point(totalSize/2, totalSize/2)
        });
      };
      
      image.onerror = () => {
        resolve(null);
      };
    });
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
