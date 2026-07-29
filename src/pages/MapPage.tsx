import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, Marker, StyleSpecification } from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import './MapPage.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2, CheckCircle2, ChevronRight, Crosshair, Database,
  Layers3, LocateFixed, MapPinned, Search, SlidersHorizontal, Trees, WalletCards,
  Star, UsersRound, X,
} from 'lucide-react';

type MapAsset = {
  id: string;
  officialId: string;
  name: string;
  agency: string;
  title: string;
  category: '건물' | '토지';
  detailType?: string;
  address: string;
  owner?: string;
  valuation: number;
  latitude: number;
  longitude: number;
  province: string;
  district: string;
  locality: string;
  coordinatePrecision: 'address' | 'administrative';
  coordinateBasis: string;
  spotlight: boolean;
};

type RegionSummary = {
  name: string;
  assetCount: number;
  totalValuation: number;
  buildingCount: number;
  landCount: number;
  officialsCount: number;
};

type MapResponse = {
  success: boolean;
  data: MapAsset[];
  summary: {
    mappedAssets: number;
    sourceAssets: number;
    geocodedAssets: number;
    officialsCount: number;
    totalValuation: number;
    buildingCount: number;
    landCount: number;
    coordinateCoverage: number;
    truncated: boolean;
  };
  regions: RegionSummary[];
  quality: {
    snapshotPolicy: string;
    valuationPolicy: string;
    coordinatePolicy: string;
    reconciliationPass: boolean;
  };
};

const mapResponseCache = new Map<string, Promise<MapResponse>>();

export function preloadMapData(year: string) {
  const key = year || 'recent';
  const cached = mapResponseCache.get(key);
  if (cached) return cached;
  const request = fetch(`/api/map?year=${encodeURIComponent(key)}&limit=75000`)
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
    .then((result: MapResponse) => {
      if (!result.success) throw new Error('지도 데이터를 불러오지 못했습니다.');
      return {
        ...result,
        data: Array.isArray(result.data) ? result.data.map(normalizeMapAsset) : [],
      };
    })
    .catch((error) => {
      mapResponseCache.delete(key);
      throw error;
    });
  mapResponseCache.set(key, request);
  return request;
}

type ClusterSummary = {
  count: number;
  valuation: number;
  officials: number;
  buildingCount: number;
  landCount: number;
  longitude: number;
  latitude: number;
  expansionZoom: number;
  addressCount: number;
  administrativeCount: number;
  items: MapAsset[];
  zoom: number;
  locationLabel: string;
};

type ClusterPointProps = {
  id: string;
  category: string;
  valuation: number;
  officialId: string;
  coordinatePrecision: string;
  spotlight: number;
};

type ClusterAggregateProps = {
  valuationSum: number;
  buildingCount: number;
  addressCount: number;
};

const emptySummary = {
  mappedAssets: 0, sourceAssets: 0, geocodedAssets: 0, officialsCount: 0,
  totalValuation: 0, buildingCount: 0, landCount: 0, coordinateCoverage: 0, truncated: false,
};

const formatCurrency = (amount: number | null | undefined) => {
  const value = Number(amount || 0);
  if (Math.abs(value) >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조 원`;
  }
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  }
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만 원`;
};

const normalizeMapAsset = (asset: MapAsset): MapAsset => {
  if (asset.coordinatePrecision === 'address' || asset.coordinatePrecision === 'administrative') return asset;
  const address = String(asset.address || '').replace(/\s+/g, ' ').trim();
  const detailed = /(?:^|\s|산)\d{1,5}(?:-\d{1,5})?(?:번지)?(?=\s|$)/.test(address)
    || /(아파트|빌라|오피스텔|타워|빌딩|센터|상가|주택|연립|맨션|단지|공장|호텔|병원|학교|대학교|시장|프라자)/.test(address);
  const coordinatePrecision = detailed ? 'address' : 'administrative';
  return {
    ...asset,
    coordinatePrecision,
    coordinateBasis: detailed
      ? '번지·건물명 등 상세 주소 기반 좌표'
      : '상세 주소가 없어 행정구역 대표 위치로 해석 필요',
    spotlight: /(국회|대통령비서실|국토교통부|한국부동산원|한국토지주택공사|대법원)/.test(String(asset.agency || '')),
  };
};

const mapStyle = (theme: string): StyleSpecification => {
  const light = theme === 'light';
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      basemap: {
        type: 'raster',
        tileSize: 256,
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        ],
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [
      { id: 'map-background', type: 'background', paint: { 'background-color': light ? '#d8e1e8' : '#101b29' } },
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        paint: {
          'raster-opacity': light ? .94 : .7,
          'raster-saturation': light ? -.12 : -.55,
          'raster-contrast': light ? .03 : .08,
          'raster-brightness-max': light ? 1 : .58,
          'raster-brightness-min': light ? 0 : .08,
        },
      },
    ],
  };
};

const featureCollection = (assets: MapAsset[]) => ({
  type: 'FeatureCollection' as const,
  features: assets.map((asset) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [asset.longitude, asset.latitude] },
    properties: {
      id: asset.id,
      category: asset.category,
      valuation: Number(asset.valuation || 0),
      officialId: asset.officialId,
      coordinatePrecision: asset.coordinatePrecision,
      spotlight: asset.spotlight ? 1 : 0,
    },
  })),
});

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const clusterIndexRef = useRef<Supercluster<ClusterPointProps, ClusterAggregateProps> | null>(null);
  const assetsByIdRef = useRef<Map<string, MapAsset>>(new Map());
  const selectedIdRef = useRef('');
  const selectedOfficialRef = useRef('');
  const modeRef = useRef<'count' | 'value'>('count');
  const renderClustersRef = useRef<() => void>(() => undefined);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const year = searchParams.get('year') || 'recent';
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [quality, setQuality] = useState<MapResponse['quality'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<'all' | '건물' | '토지'>(() => {
    const value = searchParams.get('category');
    return value === '건물' || value === '토지' ? value : 'all';
  });
  const [minimum, setMinimum] = useState(() => Math.max(0, Number(searchParams.get('min') || 0)));
  const [province, setProvince] = useState(() => searchParams.get('province') || 'all');
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const [mode, setMode] = useState<'count' | 'value'>(() => searchParams.get('mode') === 'value' ? 'value' : 'count');
  const [coordinateFilter, setCoordinateFilter] = useState<'all' | 'address' | 'administrative'>(() => {
    const value = searchParams.get('coordinate');
    return value === 'address' || value === 'administrative' ? value : 'all';
  });
  const [spotlightOnly, setSpotlightOnly] = useState(() => searchParams.get('spotlight') === '1');
  const [agencyFilter, setAgencyFilter] = useState(() => searchParams.get('agency') || 'all');
  const [titleFilter, setTitleFilter] = useState(() => searchParams.get('title') || 'all');
  const [ownerScope, setOwnerScope] = useState<'all' | 'self' | 'spouse' | 'family'>(() => {
    const value = searchParams.get('owner');
    return value === 'self' || value === 'spouse' || value === 'family' ? value : 'all';
  });
  const [officialFilter, setOfficialFilter] = useState(() => searchParams.get('official') || '');
  const [zoomLevel, setZoomLevel] = useState(() => Number(searchParams.get('z') || 6.25));
  const [selected, setSelected] = useState<MapAsset | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterSummary | null>(null);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  const selectedAssetId = searchParams.get('asset') || '';
  selectedIdRef.current = selected?.id || '';
  selectedOfficialRef.current = selected?.officialId || '';

  const selectAsset = (asset: MapAsset | null, replace = false) => {
    selectedIdRef.current = asset?.id || '';
    selectedOfficialRef.current = asset?.officialId || '';
    setSelected(asset);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (asset) next.set('asset', asset.id);
      else next.delete('asset');
      return next;
    }, { replace });
  };

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme || 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    preloadMapData(year)
      .then((result: MapResponse) => {
        if (!alive) return;
        setAssets(Array.isArray(result.data) ? result.data : []);
        setSummary(result.summary || emptySummary);
        setRegions(Array.isArray(result.regions) ? result.regions : []);
        setQuality(result.quality || null);
      })
      .catch((reason) => {
        if (alive) setError(String(reason.message || reason));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year]);

  useEffect(() => {
    if (!selectedAssetId) {
      if (selected) setSelected(null);
      return;
    }
    if (selected?.id === selectedAssetId) return;
    const restored = assets.find((asset) => asset.id === selectedAssetId);
    if (restored) setSelected(restored);
  }, [assets, selectedAssetId, selected]);

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const assign = (key: string, value: string, fallback: string) =>
        value === fallback ? next.delete(key) : next.set(key, value);
      assign('category', category, 'all');
      assign('min', String(minimum), '0');
      assign('province', province, 'all');
      assign('mode', mode, 'count');
      assign('coordinate', coordinateFilter, 'all');
      assign('spotlight', spotlightOnly ? '1' : '0', '0');
      assign('agency', agencyFilter, 'all');
      assign('title', titleFilter, 'all');
      assign('owner', ownerScope, 'all');
      assign('official', officialFilter, '');
      assign('q', query.trim(), '');
      return next;
    }, { replace: true });
  }, [category, minimum, province, mode, coordinateFilter, spotlightOnly, agencyFilter, titleFilter, ownerScope, officialFilter, query, setSearchParams]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ko-KR');
    return assets.filter((asset) =>
      (category === 'all' || asset.category === category) &&
      Number(asset.valuation) >= minimum &&
      (province === 'all' || asset.province === province) &&
      (coordinateFilter === 'all' || asset.coordinatePrecision === coordinateFilter) &&
      (!spotlightOnly || asset.spotlight) &&
      (agencyFilter === 'all' || asset.agency === agencyFilter) &&
      (titleFilter === 'all' || asset.title === titleFilter) &&
      (!officialFilter || asset.officialId === officialFilter) &&
      (ownerScope === 'all'
        || (ownerScope === 'self' && asset.owner === '본인')
        || (ownerScope === 'spouse' && asset.owner === '배우자')
        || (ownerScope === 'family' && asset.owner !== '본인' && asset.owner !== '배우자')) &&
      (!needle || `${asset.name} ${asset.agency} ${asset.address} ${asset.detailType || ''}`
        .toLocaleLowerCase('ko-KR').includes(needle))
    );
  }, [assets, category, minimum, province, coordinateFilter, spotlightOnly, agencyFilter, titleFilter, ownerScope, officialFilter, query]);

  const agencyOptions = useMemo(() => {
    const counts = new Map<string, number>();
    assets.forEach((asset) => asset.agency && counts.set(asset.agency, (counts.get(asset.agency) || 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).slice(0, 18);
  }, [assets]);

  const titleOptions = useMemo(() => {
    const counts = new Map<string, number>();
    assets.forEach((asset) => asset.title && counts.set(asset.title, (counts.get(asset.title) || 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).slice(0, 14);
  }, [assets]);

  const filteredStats = useMemo(() => {
    const people = new Set<string>();
    let valuation = 0;
    for (const asset of filtered) {
      people.add(asset.officialId);
      valuation += Number(asset.valuation || 0);
    }
    return { people: people.size, valuation };
  }, [filtered]);

  const colocatedAssets = useMemo(() => {
    if (!selected) return [];
    return filtered
      .filter((asset) =>
        Math.abs(asset.latitude - selected.latitude) < .000001 &&
        Math.abs(asset.longitude - selected.longitude) < .000001
      )
      .sort((a, b) => b.valuation - a.valuation);
  }, [filtered, selected]);

  const selectedOfficialAssets = useMemo(() => {
    if (!selected) return [];
    return assets.filter((asset) => asset.officialId === selected.officialId);
  }, [assets, selected]);

  const officialFilterPerson = useMemo(
    () => officialFilter ? assets.find((asset) => asset.officialId === officialFilter) : null,
    [assets, officialFilter]
  );

  const geojson = useMemo(() => featureCollection(filtered), [filtered]);
  modeRef.current = mode;
  const clusterIndex = useMemo(() => {
    const index = new Supercluster<ClusterPointProps, ClusterAggregateProps>({
      radius: 58,
      maxZoom: 17,
      minPoints: 2,
      map: (properties) => ({
        valuationSum: properties.valuation,
        buildingCount: properties.category === '건물' ? 1 : 0,
        addressCount: properties.coordinatePrecision === 'address' ? 1 : 0,
      }),
      reduce: (accumulated, properties) => {
        accumulated.valuationSum += properties.valuationSum;
        accumulated.buildingCount += properties.buildingCount;
        accumulated.addressCount += properties.addressCount;
      },
    });
    index.load(geojson.features);
    return index;
  }, [geojson]);
  clusterIndexRef.current = clusterIndex;
  assetsByIdRef.current = new Map(filtered.map((asset) => [asset.id, asset]));

  renderClustersRef.current = () => {
    const map = mapRef.current;
    const index = clusterIndexRef.current;
    if (!map || !index) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    const bounds = map.getBounds();
    const zoom = Math.max(0, Math.min(17, Math.floor(map.getZoom())));
    const clusters = index.getClusters(
      [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      zoom
    );
    const visible = clusters.slice(0, 900);
    for (const feature of visible) {
      if (feature.geometry.type !== 'Point') continue;
      const [longitude, latitude] = feature.geometry.coordinates;
      const properties = feature.properties as {
        cluster?: boolean;
        cluster_id?: number;
        point_count?: number;
        point_count_abbreviated?: string | number;
        id?: string;
        category?: string;
        valuation?: number;
        valuationSum?: number;
        buildingCount?: number;
        addressCount?: number;
      };
      const element = document.createElement('button');
      element.type = 'button';
      if (properties.cluster) {
        const count = Number(properties.point_count || 0);
        const tier = count >= 1500 ? 'xl' : count >= 500 ? 'lg' : count >= 100 ? 'md' : 'sm';
        const spatialStage = zoom <= 7 ? 'regional' : zoom <= 10 ? 'district' : zoom <= 13 ? 'local' : 'site';
        const clusterId = Number(properties.cluster_id);
        const valuation = Number(properties.valuationSum || 0);
        const buildingCount = Number(properties.buildingCount || 0);
        const addressCount = Number(properties.addressCount || 0);
        const primary = modeRef.current === 'value' ? formatCurrency(valuation).replace(' 원', '') : count.toLocaleString('ko-KR');
        const secondary = modeRef.current === 'value' ? `${count.toLocaleString('ko-KR')}건` : formatCurrency(valuation).replace(' 원', '');
        element.className = `asset-supercluster ${tier} ${modeRef.current} ${spatialStage}`;
        element.innerHTML = `<span class="asset-cluster-visual"><strong>${primary}</strong><small>${secondary}</small></span>`;
        element.title = `${count.toLocaleString('ko-KR')}건 · ${formatCurrency(valuation)} · 클릭하여 요약`;
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          const leaves = index.getLeaves(clusterId, Infinity);
          const officials = new Set<string>();
          const clusterAssets: MapAsset[] = [];
          for (const leaf of leaves) {
            if (leaf.properties.officialId) officials.add(String(leaf.properties.officialId));
            const clusterAsset = assetsByIdRef.current.get(String(leaf.properties.id || ''));
            if (clusterAsset) clusterAssets.push(clusterAsset);
          }
          clusterAssets.sort((a, b) => b.valuation - a.valuation);
          const leadAsset = clusterAssets[0];
          selectAsset(null, true);
          setSelectedCluster({
            count,
            valuation,
            officials: officials.size,
            buildingCount,
            landCount: count - buildingCount,
            addressCount,
            administrativeCount: count - addressCount,
            items: clusterAssets.slice(0, zoom >= 15 ? 8 : 4),
            longitude,
            latitude,
            expansionZoom: Math.min(18, index.getClusterExpansionZoom(clusterId)),
            zoom,
            locationLabel: leadAsset
              ? [leadAsset.province, leadAsset.district, leadAsset.locality].filter((value) => value && value !== '기타').join(' ')
              : '선택 위치',
          });
        });
      } else {
        const asset = assetsByIdRef.current.get(String(properties.id || ''));
        if (!asset) continue;
        const valueTier = asset.valuation >= 5_000_000_000 ? 'whale' : asset.valuation >= 1_000_000_000 ? 'high' : 'base';
        const selectionClass = asset.id === selectedIdRef.current
          ? 'selected'
          : asset.officialId === selectedOfficialRef.current ? 'related' : '';
        element.className = `asset-superpoint ${asset.category === '건물' ? 'building' : 'land'} ${asset.coordinatePrecision === 'administrative' ? 'approximate' : 'precise'} ${asset.spotlight ? 'spotlight' : ''} ${valueTier} ${selectionClass}`;
        element.title = `${asset.name} · ${formatCurrency(asset.valuation)}`;
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          setSelectedCluster(null);
          selectAsset(asset);
        });
      }
      markersRef.current.push(
        new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([longitude, latitude])
          .addTo(map)
      );
    }
    if (containerRef.current) {
      containerRef.current.dataset.sourceFeatures = String(filtered.length);
      containerRef.current.dataset.renderedFeatures = String(markersRef.current.length);
      containerRef.current.dataset.mapLayers = 'ready';
    }
  };

  useEffect(() => {
    renderClustersRef.current();
  }, [clusterIndex, mode]);

  useEffect(() => {
    renderClustersRef.current();
  }, [selected?.id]);

  useEffect(() => {
    if (!containerRef.current || error) return;
    const initialLng = Number(searchParams.get('x') || 127.8);
    const initialLat = Number(searchParams.get('y') || 36.3);
    const initialZoom = Number(searchParams.get('z') || 6.25);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(theme),
      center: [initialLng, initialLat],
      zoom: initialZoom,
      minZoom: 5,
      maxZoom: 18,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('error', (event) => {
      if (containerRef.current) containerRef.current.dataset.mapError = event.error?.message || String(event.error);
    });
    map.on('load', () => {
      if (containerRef.current) delete containerRef.current.dataset.mapError;
      setZoomLevel(map.getZoom());
      renderClustersRef.current();
    });
    map.on('moveend', () => {
      setZoomLevel(map.getZoom());
      renderClustersRef.current();
      const center = map.getCenter();
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('x', center.lng.toFixed(5));
        next.set('y', center.lat.toFixed(5));
        next.set('z', map.getZoom().toFixed(2));
        if (selectedIdRef.current) next.set('asset', selectedIdRef.current);
        return next;
      }, { replace: true });
    });
    let resizeFrame = 0;
    let resizeSettleTimer = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        map.resize();
      });
      window.clearTimeout(resizeSettleTimer);
      resizeSettleTimer = window.setTimeout(() => {
        map.resize();
        renderClustersRef.current();
      }, 90);
    });
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      window.clearTimeout(resizeSettleTimer);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  // Map style changes require a clean WebGL instance; data/filter updates are handled independently.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, error]);

  const focusRegion = (region: string) => {
    setProvince(region);
    const candidates = assets.filter((asset) => asset.province === region);
    if (!candidates.length || !mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    candidates.forEach((asset) => bounds.extend([asset.longitude, asset.latitude]));
    mapRef.current.fitBounds(bounds, { padding: 70, maxZoom: 10, duration: 700 });
  };

  const focusSearchResults = () => {
    if (!filtered.length || !mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    filtered.forEach((asset) => bounds.extend([asset.longitude, asset.latitude]));
    if (filtered.length === 1) {
      mapRef.current.easeTo({ center: [filtered[0].longitude, filtered[0].latitude], zoom: 16, duration: 650 });
      selectAsset(filtered[0]);
    } else {
      mapRef.current.fitBounds(bounds, { padding: 90, maxZoom: 14, duration: 650 });
    }
  };

  const toggleOfficialFocus = () => {
    if (!selected) return;
    if (officialFilter === selected.officialId) {
      setOfficialFilter('');
      return;
    }
    setOfficialFilter(selected.officialId);
    if (!selectedOfficialAssets.length || !mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    selectedOfficialAssets.forEach((asset) => bounds.extend([asset.longitude, asset.latitude]));
    mapRef.current.fitBounds(bounds, { padding: 100, maxZoom: 14, duration: 650 });
  };

  const resetView = () => {
    setCategory('all');
    setMinimum(0);
    setProvince('all');
    setQuery('');
    setCoordinateFilter('all');
    setSpotlightOnly(false);
    setAgencyFilter('all');
    setTitleFilter('all');
    setOwnerScope('all');
    setOfficialFilter('');
    selectAsset(null, true);
    setSelectedCluster(null);
    mapRef.current?.easeTo({ center: [127.8, 36.3], zoom: 6.25, duration: 700 });
  };

  const metrics = [
    { label: '지도 반영 자산', value: `${filtered.length.toLocaleString('ko-KR')}건`, detail: `원본 좌표 ${summary.geocodedAssets.toLocaleString('ko-KR')}건`, icon: <MapPinned size={17} />, color: '#38bdf8' },
    { label: '필터 신고가액', value: formatCurrency(filteredStats.valuation), detail: '공식 평가액 · 시세 추정 없음', icon: <Database size={17} />, color: '#fbbf24' },
    { label: '보유 공직자', value: `${filteredStats.people.toLocaleString('ko-KR')}명`, detail: '현재 지도 범위 중복 제거', icon: <UsersRound size={17} />, color: '#a78bfa' },
    { label: '좌표 포괄률', value: `${(summary.coordinateCoverage * 100).toFixed(1)}%`, detail: `${summary.sourceAssets.toLocaleString('ko-KR')}개 부동산 원문 기준`, icon: <Crosshair size={17} />, color: '#34d399' },
  ];
  const hierarchy = [
    { label: '전국', min: 0 },
    { label: '광역', min: 7.2 },
    { label: '시군구', min: 9.3 },
    { label: '동네', min: 12.2 },
    { label: '개별 위치', min: 15.2 },
  ];
  const activeHierarchy = hierarchy.reduce((active, item, index) => zoomLevel >= item.min ? index : active, 0);

  return (
    <div className="asset-map-page">
      <section className="asset-map-heading">
        <div>
          <span className="asset-map-eyebrow"><LocateFixed size={14} /> K-WHALE SPATIAL INTELLIGENCE</span>
          <h2>전국 자산 흐름을 한눈에</h2>
          <p>공식 신고서의 건물·토지 좌표를 지역 밀도에서 개별 자산까지 연결합니다.</p>
        </div>
        <div className={`asset-map-quality ${quality?.reconciliationPass ? 'pass' : 'check'}`}
          title={quality?.coordinatePolicy}>
          <CheckCircle2 size={15} /> 공간 원장 대사 {quality?.reconciliationPass ? 'PASS' : 'CHECK'}
        </div>
      </section>

      <section className="asset-map-metrics">
        {metrics.map((metric) => (
          <article key={metric.label} style={{ '--map-accent': metric.color } as React.CSSProperties}>
            <span>{metric.icon}{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section className="asset-map-workspace">
        <div
          ref={containerRef}
          className="asset-map-canvas"
          aria-label="전국 공직자 부동산 지도"
          data-feature-count={geojson.features.length}
        />
        {loading && <div className="asset-map-state"><i /><strong>공간 원장을 구성하는 중…</strong><span>좌표·연도·인물 관계를 대사하고 있습니다.</span></div>}
        {error && <div className="asset-map-state error"><strong>지도를 불러오지 못했습니다</strong><span>{error}</span><button onClick={() => location.reload()}>다시 시도</button></div>}

        <button className="asset-map-mobile-filter" onClick={() => setMobileFilters(true)}>
          <SlidersHorizontal size={16} /> 지도 필터
        </button>

        <div className="asset-map-hierarchy" aria-label="지도 탐색 단계">
          {hierarchy.map((item, index) => (
            <button
              key={item.label}
              className={index === activeHierarchy ? 'active' : index < activeHierarchy ? 'passed' : ''}
              onClick={() => {
                if (index === 0) {
                  resetView();
                  return;
                }
                mapRef.current?.easeTo({ zoom: Math.max(6.25, item.min + .15), duration: 550 });
              }}
              title={index === 0 ? '모든 필터를 해제하고 전국 보기' : `${item.label} 단계로 확대`}
            >
              <i />{item.label}
            </button>
          ))}
        </div>

        <aside className={`asset-map-controls ${mobileFilters ? 'open' : ''}`}>
          <div className="asset-map-controls-head">
            <div><strong>공간 탐색 렌즈</strong><small>{filtered.length.toLocaleString('ko-KR')}개 자산 활성</small></div>
            <button onClick={() => setMobileFilters(false)} aria-label="필터 닫기"><X size={17} /></button>
          </div>
          {officialFilterPerson && (
            <div className="asset-map-active-person">
              <span><UsersRound size={13} /><b>{officialFilterPerson.name}</b> 자산만 탐색 중</span>
              <button onClick={() => setOfficialFilter('')} aria-label="인물 필터 해제"><X size={13} /></button>
            </div>
          )}
          <label className="asset-map-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') focusSearchResults(); }}
              placeholder="공직자·기관·주소 검색"
            />
            {query && <button onClick={() => setQuery('')} aria-label="검색어 지우기"><X size={14} /></button>}
            <button onClick={focusSearchResults} aria-label="검색 결과로 이동" title="검색 결과로 이동"><LocateFixed size={14} /></button>
          </label>
          <div className="asset-map-filter">
            <span>자산군</span>
            <div className="asset-map-segments">
              {(['all', '건물', '토지'] as const).map((value) => (
                <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>
                  {value === 'all' ? <Layers3 size={14} /> : value === '건물' ? <Building2 size={14} /> : <Trees size={14} />}
                  {value === 'all' ? '전체' : value}
                </button>
              ))}
            </div>
          </div>
          <div className="asset-map-filter">
            <span>최소 신고가액</span>
            <div className="asset-map-pills">
              {[
                [0, '전체'], [100_000_000, '1억+'], [1_000_000_000, '10억+'], [5_000_000_000, '50억+'],
              ].map(([value, label]) => (
                <button key={value} aria-pressed={minimum === value} onClick={() => setMinimum(Number(value))}>{label}</button>
              ))}
            </div>
          </div>
          <div className="asset-map-filter">
            <span>표현 방식</span>
            <div className="asset-map-segments">
              <button aria-pressed={mode === 'count'} onClick={() => setMode('count')}><Layers3 size={14} /> 자산 건수</button>
              <button aria-pressed={mode === 'value'} onClick={() => setMode('value')}><WalletCards size={14} /> 신고가액</button>
            </div>
          </div>
          <div className="asset-map-filter">
            <span>좌표 신뢰도</span>
            <div className="asset-map-segments">
              {([
                ['all', '전체'],
                ['address', '상세 주소'],
                ['administrative', '행정구역'],
              ] as const).map(([value, label]) => (
                <button key={value} aria-pressed={coordinateFilter === value} onClick={() => setCoordinateFilter(value)}>
                  <Crosshair size={13} /> {label}
                </button>
              ))}
            </div>
          </div>
          <button className={`asset-map-spotlight-filter ${spotlightOnly ? 'active' : ''}`} onClick={() => setSpotlightOnly((value) => !value)}>
            <Star size={13} /> 핵심기관 보유 자산만
          </button>
          <div className="asset-map-filter asset-map-entity-filter">
            <span>신고 주체</span>
            <div className="asset-map-selects">
              <select value={agencyFilter} onChange={(event) => setAgencyFilter(event.target.value)} aria-label="기관 필터">
                <option value="all">전체 기관</option>
                {agencyOptions.map(([name, count]) => <option key={name} value={name}>{name} · {count.toLocaleString('ko-KR')}건</option>)}
              </select>
              <select value={titleFilter} onChange={(event) => setTitleFilter(event.target.value)} aria-label="직책 필터">
                <option value="all">전체 직책</option>
                {titleOptions.map(([name, count]) => <option key={name} value={name}>{name} · {count.toLocaleString('ko-KR')}건</option>)}
              </select>
            </div>
            <div className="asset-map-owner-pills">
              {([
                ['all', '전체 명의'],
                ['self', '본인'],
                ['spouse', '배우자'],
                ['family', '기타 가족'],
              ] as const).map(([value, label]) => (
                <button key={value} aria-pressed={ownerScope === value} onClick={() => setOwnerScope(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="asset-map-region-head">
            <span>광역 신고가액</span>
            {province !== 'all' && <button onClick={() => setProvince('all')}>전국으로</button>}
          </div>
          <div className="asset-map-regions">
            {regions.map((region, index) => (
              <button key={region.name} className={province === region.name ? 'active' : ''} onClick={() => focusRegion(region.name)}>
                <b>{index + 1}</b>
                <span><strong>{region.name}</strong><small>{region.assetCount.toLocaleString('ko-KR')}건 · {region.officialsCount.toLocaleString('ko-KR')}명</small></span>
                <em>{formatCurrency(region.totalValuation)}</em>
              </button>
            ))}
          </div>
          <button className="asset-map-reset" onClick={resetView}>필터와 지도 위치 초기화</button>
        </aside>

        {selected && (
          <aside className="asset-map-detail">
            <button className="asset-map-detail-close" onClick={() => selectAsset(null)} aria-label="자산 상세 닫기"><X size={17} /></button>
            <span className={`asset-map-category ${selected.category === '건물' ? 'building' : 'land'}`}>{selected.category} · {selected.detailType || '소분류 미제공'}</span>
            <h3>{selected.address}</h3>
            <strong className="asset-map-value">{formatCurrency(selected.valuation)}</strong>
            <div className="asset-map-owner">
              <small>신고 보유자 · {selected.owner || '명의 미제공'}</small>
              <b>{selected.name}</b>
              <span>{selected.agency} · {selected.title || '직위 미상'}</span>
            </div>
            <div className="asset-map-location">
              <span>{selected.province}</span><ChevronRight size={13} /><span>{selected.district}</span><ChevronRight size={13} /><span>{selected.locality}</span>
            </div>
            <div className={`asset-map-coordinate-note ${selected.coordinatePrecision}`}>
              <Crosshair size={13} />
              <span><b>{selected.coordinatePrecision === 'address' ? '상세 주소 좌표' : '행정구역 대표 좌표'}</b>{selected.coordinateBasis}</span>
            </div>
            {colocatedAssets.length > 1 && (
              <div className="asset-map-colocated">
                <div>
                  <strong>동일 좌표 자산</strong>
                  <small>{colocatedAssets.length.toLocaleString('ko-KR')}건 · {new Set(colocatedAssets.map((asset) => asset.officialId)).size.toLocaleString('ko-KR')}명</small>
                </div>
                <div className="asset-map-colocated-list">
                  {colocatedAssets.slice(0, 6).map((asset) => (
                    <button key={asset.id} className={asset.id === selected.id ? 'active' : ''} onClick={() => selectAsset(asset)}>
                      <span><b>{asset.name}</b><small>{asset.owner || '명의 미제공'} · {asset.category}</small></span>
                      <strong>{formatCurrency(asset.valuation)}</strong>
                    </button>
                  ))}
                </div>
                {colocatedAssets.length > 6 && <small className="asset-map-more">외 {(colocatedAssets.length - 6).toLocaleString('ko-KR')}건은 확대 후 순차 표시</small>}
              </div>
            )}
            <button
              className={`asset-map-person-focus ${officialFilter === selected.officialId ? 'active' : ''}`}
              onClick={toggleOfficialFocus}
            >
              <UsersRound size={14} />
              <span>{officialFilter === selected.officialId ? '이 인물 분포 보기 해제' : '이 인물의 전국 자산만 보기'}<small>{selectedOfficialAssets.length.toLocaleString('ko-KR')}건 · 공식 신고 좌표</small></span>
            </button>
            <button className="asset-map-profile" onClick={() => navigate(`/officials/${selected.officialId}?year=${year}`)}>
              공직자 포트폴리오 열기 <ChevronRight size={16} />
            </button>
            <small className="asset-map-caveat">공식 신고가액이며 현재 시세나 실거래가 추정치가 아닙니다.</small>
          </aside>
        )}

        {selectedCluster && !selected && (
          <aside className="asset-map-detail asset-map-cluster-detail">
            <button className="asset-map-detail-close" onClick={() => setSelectedCluster(null)} aria-label="지역 묶음 닫기"><X size={17} /></button>
            <span className="asset-map-category cluster">{selectedCluster.zoom >= 15 ? '동일·인접 위치 자산' : '현재 화면의 자산 묶음'}</span>
            <h3><small className="asset-map-cluster-place">{selectedCluster.locationLabel}</small>{selectedCluster.count.toLocaleString('ko-KR')}건의 신고 부동산</h3>
            <strong className="asset-map-value">{formatCurrency(selectedCluster.valuation)}</strong>
            <div className="asset-map-cluster-grid">
              <span><small>공직자</small><b>{selectedCluster.officials.toLocaleString('ko-KR')}명</b></span>
              <span><small>건물</small><b>{selectedCluster.buildingCount.toLocaleString('ko-KR')}건</b></span>
              <span><small>토지</small><b>{selectedCluster.landCount.toLocaleString('ko-KR')}건</b></span>
            </div>
            <div className="asset-map-coordinate-split">
              <span><i className="precise" /> 상세 주소 {selectedCluster.addressCount.toLocaleString('ko-KR')}건</span>
              <span><i className="approximate" /> 행정구역 좌표 {selectedCluster.administrativeCount.toLocaleString('ko-KR')}건</span>
            </div>
            <div className="asset-map-cluster-assets">
              {selectedCluster.items.map((asset) => (
                <button key={asset.id} onClick={() => {
                  setSelectedCluster(null);
                  selectAsset(asset);
                  mapRef.current?.easeTo({ center: [asset.longitude, asset.latitude], zoom: 16, duration: 650 });
                }}>
                  <span><b>{asset.name}</b><small>{asset.address}</small></span>
                  <strong>{formatCurrency(asset.valuation)}</strong>
                </button>
              ))}
            </div>
            <button className="asset-map-profile" onClick={() => {
              mapRef.current?.easeTo({
                center: [selectedCluster.longitude, selectedCluster.latitude],
                zoom: selectedCluster.expansionZoom,
                duration: 650,
              });
              setSelectedCluster(null);
            }}>
              이 묶음 안으로 확대 <ChevronRight size={16} />
            </button>
            <small className="asset-map-caveat">원 안의 두 숫자는 선택한 렌즈에 따라 자산 건수와 공식 신고가액을 함께 표시합니다.</small>
          </aside>
        )}

        <div className="asset-map-legend">
          <span><i className="building precise" /> 상세 주소</span><span><i className="land approximate" /> 행정구역 좌표</span><span><i className="spotlight" /> 핵심기관</span>
          {selected && <span><i className="selection" /> 선택·동일 인물</span>}
          <b>{mode === 'count' ? '큰 숫자 = 자산 건수 · 작은 숫자 = 신고가액' : '큰 숫자 = 신고가액 · 작은 숫자 = 자산 건수'}</b>
        </div>
      </section>

      <section className="asset-map-method">
        <span><CheckCircle2 size={14} /> {quality?.valuationPolicy || '공식 신고가액 기준'}</span>
        <span>{quality?.snapshotPolicy || '선택 연도 인물별 최신 스냅샷'}</span>
        {summary.truncated && <strong>표시 한도 적용 · 상위 {summary.mappedAssets.toLocaleString('ko-KR')}건</strong>}
      </section>
    </div>
  );
}
