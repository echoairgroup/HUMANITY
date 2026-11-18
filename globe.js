'use strict';

(() => {
  const WORLD_DATA_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
  let worldDataPromise = null;

  function loadWorldData() {
    if (!worldDataPromise) {
      worldDataPromise = fetch(WORLD_DATA_URL, { cache: 'force-cache' })
        .then(response => {
          if (!response.ok) throw new Error('World map returned HTTP ' + response.status);
          return response.json();
        })
        .then(data => {
          if (!data || !Array.isArray(data.features)) {
            throw new Error('World map data is not a GeoJSON feature collection.');
          }
          return {
            type: 'FeatureCollection',
            features: data.features.filter(feature =>
              feature && feature.geometry &&
              ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)
            )
          };
        })
        .catch(error => {
          worldDataPromise = null;
          throw error;
        });
    }
    return worldDataPromise;
  }

  function renderGlobe(groupId, size, radius, fill, stroke, strokeWidth) {
    const group = document.getElementById(groupId);
    if (!group || !window.d3 ||
        typeof window.d3.geoOrthographic !== 'function' ||
        typeof window.d3.geoPath !== 'function') return false;

    const projection = window.d3.geoOrthographic()
      .rotate([-12, -13, 0])
      .clipAngle(90)
      .precision(0.35)
      .scale(radius)
      .translate([size / 2, size / 2]);

    const path = window.d3.geoPath(projection);
    const landPath = path(window.__humanityWorldFeatures);
    if (!landPath) return false;

    const land = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    land.setAttribute('d', landPath);
    land.setAttribute('fill', fill);
    land.setAttribute('stroke', stroke);
    land.setAttribute('stroke-width', String(strokeWidth));
    land.setAttribute('stroke-linejoin', 'round');
    land.setAttribute('stroke-linecap', 'round');
    land.setAttribute('vector-effect', 'non-scaling-stroke');
    land.setAttribute('fill-rule', 'evenodd');
    land.setAttribute('aria-hidden', 'true');

    group.replaceChildren(land);
    group.dataset.realGeography = 'true';
    const svg = group.closest('svg');
    if (svg) svg.dataset.globeReady = 'true';
    return true;
  }

  async function initialise() {
    const mainGlobe = document.getElementById('globe-land-main');
    const arcadeGlobe = document.getElementById('globe-land-arcade');
    if (!mainGlobe && !arcadeGlobe) return;

    try {
      const collection = await loadWorldData();
      window.__humanityWorldFeatures = collection;

      renderGlobe('globe-land-main', 420, 154, '#183b35', '#426a56', 0.65);
      renderGlobe('globe-land-arcade', 330, 119, '#8fae85', '#668c75', 0.7);
    } catch (error) {
      // The handcrafted fallback shapes remain in the SVG if the map provider
      // or projection library is unavailable.
      console.warn('HUMANITY globe is using its fallback illustration:', error.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
