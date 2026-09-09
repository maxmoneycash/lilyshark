import L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

// Keep the renderer and its bundled worker out of the initial application chunk.
// Sources and usage terms: https://openfreemap.org/quick_start/
setWorkerUrl(workerUrl);

export function createVectorBasemap(light: boolean): L.MaplibreGL {
  const layer = maplibreGL({
    style: `https://tiles.openfreemap.org/styles/${light ? 'positron' : 'dark'}`,
    attributionControl: { customAttribution: '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' },
    renderWorldCopies: false,
    fadeDuration: 0,
  });
  if (!light) layer.on('add', () => {
    const renderer = layer.getMaplibreMap();
    renderer.once('style.load', () => {
      // Preserve geographic detail while making dark-map labels readable under
      // our controls. The provider's default dark labels are only medium gray.
      for (const item of renderer.getStyle().layers) {
        if (item.type === 'symbol' && item.layout?.['text-field']) {
          renderer.setPaintProperty(item.id, 'text-color', item.id.startsWith('place_') ? '#b4bdc5' : '#92a3b1');
          renderer.setPaintProperty(item.id, 'text-halo-color', '#171c22');
          renderer.setPaintProperty(item.id, 'text-halo-width', 1.2);
        }
        if (item.type === 'line' && item.id.startsWith('highway_')) {
          renderer.setPaintProperty(item.id, 'line-color', item.id.includes('casing') ? '#252e37' : item.id.includes('motorway') ? '#485563' : '#343d49');
        }
      }
      if (renderer.getLayer('background')) renderer.setPaintProperty('background', 'background-color', '#171c22');
      if (renderer.getLayer('water')) renderer.setPaintProperty('water', 'fill-color', '#263440');
      if (renderer.getLayer('landuse_park')) renderer.setPaintProperty('landuse_park', 'fill-color', '#202d2c');
    });
  });
  return layer;
}
