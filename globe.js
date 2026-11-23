'use strict';

(() => {
  const WORLD_DATA_URL = './world-countries.geojson';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let worldDataPromise = null;
  let globeIndex = 0;

  function loadWorldData() {
    if (!worldDataPromise) {
      worldDataPromise = fetch(WORLD_DATA_URL, { cache: 'force-cache' })
        .then(response => {
          if (!response.ok) throw new Error('World country data returned HTTP ' + response.status);
          return response.json();
        })
        .then(data => {
          if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
            throw new Error('World country data is not a GeoJSON feature collection.');
          }
          const features = data.features.filter(feature =>
            feature && feature.geometry &&
            ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)
          );
          if (features.length < 150) throw new Error('World country data is incomplete.');
          return { type: 'FeatureCollection', features };
        })
        .catch(error => {
          worldDataPromise = null;
          throw error;
        });
    }
    return worldDataPromise;
  }

  function svgElement(name, attributes) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes || {}).forEach(([key, value]) => {
      element.setAttribute(key, String(value));
    });
    return element;
  }

  function renderEarth(container, collection, index) {
    if (!window.d3 || typeof window.d3.geoOrthographic !== 'function' ||
        typeof window.d3.geoPath !== 'function' || typeof window.d3.geoGraticule !== 'function') {
      throw new Error('The geographic projection library is unavailable.');
    }

    const id = 'humanity-earth-' + index;
    const size = 200;
    const center = size / 2;
    const projection = window.d3.geoOrthographic()
      .rotate([-18 - (index * 58), -14 + ((index % 2) * 8), 0])
      .clipAngle(90)
      .precision(0.25)
      .scale(92)
      .translate([center, center]);
    const path = window.d3.geoPath(projection);

    const svg = svgElement('svg', {
      viewBox: '0 0 200 200',
      role: 'presentation',
      focusable: 'false',
      'aria-hidden': 'true'
    });

    const defs = svgElement('defs');
    const clip = svgElement('clipPath', { id: id + '-clip' });
    clip.appendChild(svgElement('circle', { cx: center, cy: center, r: 92 }));
    defs.appendChild(clip);

    const water = svgElement('radialGradient', {
      id: id + '-water',
      cx: '32%',
      cy: '25%',
      r: '78%'
    });
    water.appendChild(svgElement('stop', { offset: '0%', 'stop-color': '#2b8194' }));
    water.appendChild(svgElement('stop', { offset: '58%', 'stop-color': '#15536d' }));
    water.appendChild(svgElement('stop', { offset: '100%', 'stop-color': '#092d49' }));
    defs.appendChild(water);

    const light = svgElement('radialGradient', {
      id: id + '-light',
      cx: '30%',
      cy: '23%',
      r: '82%'
    });
    light.appendChild(svgElement('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '.28' }));
    light.appendChild(svgElement('stop', { offset: '55%', 'stop-color': '#ffffff', 'stop-opacity': '.03' }));
    light.appendChild(svgElement('stop', { offset: '100%', 'stop-color': '#020b19', 'stop-opacity': '.36' }));
    defs.appendChild(light);
    svg.appendChild(defs);

    svg.appendChild(svgElement('circle', {
      cx: center, cy: center, r: 92, fill: 'url(#' + id + '-water)'
    }));

    const map = svgElement('g', { 'clip-path': 'url(#' + id + '-clip)' });
    const graticule = path(window.d3.geoGraticule().step([30, 30])());
    if (graticule) {
      map.appendChild(svgElement('path', {
        d: graticule,
        fill: 'none',
        stroke: '#d4e9ed',
        'stroke-opacity': '.18',
        'stroke-width': '.55'
      }));
    }

    const countries = svgElement('g', { class: 'earth-countries' });
    collection.features.forEach(feature => {
      const d = path(feature);
      if (!d) return;
      countries.appendChild(svgElement('path', {
        d,
        fill: '#82b487',
        stroke: '#d6e8d7',
        'stroke-width': '.48',
        'stroke-linejoin': 'round',
        'fill-rule': 'evenodd',
        'vector-effect': 'non-scaling-stroke'
      }));
    });
    map.appendChild(countries);
    svg.appendChild(map);

    svg.appendChild(svgElement('circle', {
      cx: center, cy: center, r: 92,
      fill: 'url(#' + id + '-light)',
      stroke: '#d4e7da',
      'stroke-opacity': '.52',
      'stroke-width': '.9'
    }));

    container.replaceChildren(svg);
    container.dataset.globeReady = 'true';
    container.dataset.globeSource = 'Natural Earth country boundaries';
    container.removeAttribute('data-globe-error');
    container.setAttribute('aria-label', 'Earth globe with real country borders and coastlines');
  }

  async function initialise() {
    const globes = Array.from(document.querySelectorAll('[data-earth-globe]'));
    if (!globes.length) return;

    try {
      const collection = await loadWorldData();
      globes.forEach(container => {
        globeIndex += 1;
        renderEarth(container, collection, globeIndex);
      });
      document.documentElement.dataset.earthGlobesReady = 'true';
    } catch (error) {
      globes.forEach(container => {
        container.dataset.globeError = 'true';
        container.textContent = 'Earth map unavailable';
      });
      console.error('HUMANITY could not render the real Earth map:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
