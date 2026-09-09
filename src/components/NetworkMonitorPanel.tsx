import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, CircleDot, Cloud, Copy, Edit3, Globe, Grid3X3,
  Download, FileSpreadsheet, LayoutGrid, Link2, List, MapPin, Monitor, Network, Play,
  Plus, Printer, RefreshCw, Router, Save, Search, Server, Shield, StickyNote, Terminal,
  Trash2, Unlink, Upload, Wifi, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { api } from '@/lib/api';
import * as XLSX from 'xlsx';
import type {
  BranchInfo, NetworkMonitor, NetworkMonitorEvent, NetworkService, SectionPermissions,
  NetworkTopologyLayout, NetworkTopologyNode, NetworkTopologyNodeKind,
  NetworkTopologyWorkspaceSummary,
} from '@/lib/types';
import BranchRecordSelector, { defaultRecordBranch } from './BranchRecordSelector';

const EMPTY = {
  name: '',
  host: '',
  description: '',
  deviceType: 'UNKNOWN' as NetworkMonitor['deviceType'],
  vendor: '',
  location: '',
  operatingSystem: 'UNKNOWN' as NetworkMonitor['operatingSystem'],
  snmpEnabled: false,
  snmpVersion: '2c' as NetworkMonitor['snmpVersion'],
  snmpPort: 161,
  snmpCommunity: '',
  snmpUsername: '',
  snmpAuthProtocol: 'SHA' as NetworkMonitor['snmpAuthProtocol'],
  snmpAuthKey: '',
  snmpPrivProtocol: 'AES' as NetworkMonitor['snmpPrivProtocol'],
  snmpPrivKey: '',
  intervalSeconds: 60,
  failureThreshold: 3,
  timeoutMs: 2000,
  emailTo: '',
  downSubject: '[Operis] {name} - ERİŞİM YOK',
  downBody: '{name} ({host}) adresine erişim sağlanamıyor.\nArdışık başarısız ping: {failures}\nAçıklama: {description}\nZaman: {time}',
  upSubject: '[Operis] {name} - ERİŞİM VAR',
  upBody: '{name} ({host}) adresine erişim yeniden sağlandı.\nGecikme: {latency} ms\nAçıklama: {description}\nZaman: {time}',
  active: true,
  positionX: 20,
  positionY: 20,
};

const EMPTY_SERVICE = {
  name: '',
  protocol: 'TCP' as NetworkService['protocol'],
  port: 443,
  path: '/',
  expectedStatus: null as number | null,
  timeoutMs: 3000,
  active: true,
};

type FormState = typeof EMPTY;
type ServiceForm = typeof EMPTY_SERVICE;
type Tab = 'dashboard' | 'devices' | 'discovery' | 'topology';
type TopologyMode = 'map' | 'compact' | 'directory';

const EMPTY_TOPOLOGY_LAYOUT: NetworkTopologyLayout = {
  nodes: [],
  links: [],
  settings: { width: 1800, height: 1100, grid: true, snap: true, zoom: 0.8 },
};

const TOPOLOGY_KIND_LABELS: Record<NetworkTopologyNodeKind, string> = {
  DEVICE: 'Cihaz',
  ROUTER: 'Router',
  SWITCH: 'Switch',
  SERVER: 'Sunucu',
  FIREWALL: 'Firewall',
  INTERNET: 'İnternet',
  LOCATION: 'Lokasyon',
  NOTE: 'Not',
  CLOUD: 'Bulut',
  AP: 'Access Point',
  PRINTER: 'Yazıcı',
};


type SnmpData = {
  enabled: boolean;
  version: string;
  latest: null | {
    id: string; sysName: string; sysDescr: string; sysLocation: string; sysContact: string;
    sysUptimeTicks: string | null; cpuPercent: number | null; memoryPercent: number | null;
    diskPercent: number | null; createdAt: number;
  };
  samples: Array<{ cpuPercent: number | null; memoryPercent: number | null; diskPercent: number | null; createdAt: number }>;
  interfaces: Array<{
    interfaceIndex: number; interfaceName: string; adminStatus: number | null; operStatus: number | null;
    speedBps: string | null; inBps: number | null; outBps: number | null; createdAt: number;
  }>;
};

type Summary = {
  total: number;
  online: number;
  offline: number;
  unknown: number;
  active: number;
  servicesTotal: number;
  servicesOnline: number;
  servicesOffline: number;
  averageLatencyMs: number;
  alarms24h: number;
  recentAlarms: Array<{ id: string; monitorId: string; status: string; message: string; createdAt: number }>;
};

type Metrics = {
  hours: number;
  totalSamples: number;
  uptimePercent: number;
  packetLossPercent: number;
  downtimeMinutes: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  samples: Array<{ at: number; success: boolean; latencyMs: number | null }>;
};

type DiscoveryResult = {
  ip: string;
  hostname: string;
  latencyMs: number | null;
  deviceType: string;
  alreadyMonitored: boolean;
};

type NetworkExcelImportResult = {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
};


const EMPTY_SUMMARY: Summary = {
  total: 0, online: 0, offline: 0, unknown: 0, active: 0,
  servicesTotal: 0, servicesOnline: 0, servicesOffline: 0,
  averageLatencyMs: 0, alarms24h: 0, recentAlarms: [],
};

const DEVICE_LABELS: Record<string, string> = {
  UNKNOWN: 'Bilinmiyor',
  ROUTER: 'Router',
  SWITCH: 'Switch',
  SERVER: 'Sunucu',
  COMPUTER: 'Bilgisayar',
  PRINTER: 'Yazıcı',
  ACCESS_POINT: 'Access Point',
  FIREWALL: 'Firewall',
  OTHER: 'Diğer',
};

const SERVICE_DEFAULT_PORTS: Record<NetworkService['protocol'], number> = {
  TCP: 443,
  HTTP: 80,
  HTTPS: 443,
  SSH: 22,
  FTP: 21,
  DNS: 53,
  SMTP: 25,
};

export default function NetworkMonitorPanel({
  permissions,
  isAdmin,
  branches,
}: {
  permissions: SectionPermissions;
  isAdmin: boolean;
  branches: BranchInfo[];
}) {
  const can = (key: keyof SectionPermissions) => isAdmin || permissions[key];
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('operis-network-tab') as Tab) || 'dashboard');
  const [items, setItems] = useState<NetworkMonitor[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [branchCode, setBranchCode] = useState(() => defaultRecordBranch(branches));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [events, setEvents] = useState<NetworkMonitorEvent[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsHours, setMetricsHours] = useState(24);
  const [services, setServices] = useState<NetworkService[]>([]);
  const [serviceForm, setServiceForm] = useState<ServiceForm>(EMPTY_SERVICE);
  const [serviceEditingId, setServiceEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [topologyMode, setTopologyMode] = useState<TopologyMode>(() => (sessionStorage.getItem('operis-network-topology-mode') as TopologyMode) || 'map');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: NetworkMonitor } | null>(null);
  const [snmpData, setSnmpData] = useState<SnmpData | null>(null);
  const [snmpBusy, setSnmpBusy] = useState(false);
  const [topologyWorkspaces, setTopologyWorkspaces] = useState<NetworkTopologyWorkspaceSummary[]>([]);
  const [topologyWorkspaceId, setTopologyWorkspaceId] = useState('');
  const [topologyWorkspaceName, setTopologyWorkspaceName] = useState('Ana Ağ Mimarisi');
  const [topologyWorkspaceDescription, setTopologyWorkspaceDescription] = useState('');
  const [topologyBranchCode, setTopologyBranchCode] = useState(() => defaultRecordBranch(branches));
  const [topologyLayout, setTopologyLayout] = useState<NetworkTopologyLayout>(EMPTY_TOPOLOGY_LAYOUT);
  const [topologyEditing, setTopologyEditing] = useState(false);
  const [topologyDirty, setTopologyDirty] = useState(false);
  const [topologyConnecting, setTopologyConnecting] = useState(false);
  const [topologyLinkStartId, setTopologyLinkStartId] = useState('');
  const [topologyDraggingNodeId, setTopologyDraggingNodeId] = useState('');
  const [topologyNewLabel, setTopologyNewLabel] = useState('');


  const [discoverBranch, setDiscoverBranch] = useState(() => defaultRecordBranch(branches));

  useEffect(() => {
    const validCodes = new Set(branches.map(branch => branch.code));
    const fallback = defaultRecordBranch(branches);

    setBranchCode(current => current && validCodes.has(current) ? current : fallback);
    setDiscoverBranch(current => current && validCodes.has(current) ? current : fallback);
    setTopologyBranchCode(current => current && validCodes.has(current) ? current : fallback);
  }, [branches]);
  const [cidr, setCidr] = useState('10.20.128.0/24');
  const [discoverTimeout, setDiscoverTimeout] = useState(1000);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([]);
  const [selectedDiscovery, setSelectedDiscovery] = useState<Set<string>>(new Set());
  const [discoveryInfo, setDiscoveryInfo] = useState('');
  const [networkExcelImportResult, setNetworkExcelImportResult] = useState<NetworkExcelImportResult | null>(null);
  const [networkExcelImporting, setNetworkExcelImporting] = useState(false);


  const load = async () => {
    const [nextItems, nextSummary, nextWorkspaces] = await Promise.all([
      api.getNetworkMonitors(),
      api.getNetworkSummary(),
      api.getNetworkTopologyWorkspaces().catch(() => []),
    ]);
    setItems(nextItems);
    setSummary(nextSummary);
    setTopologyWorkspaces(nextWorkspaces);
  };

  useEffect(() => {
    sessionStorage.setItem('operis-network-tab', tab);
  }, [tab]);

  useEffect(() => {
    sessionStorage.setItem('operis-network-topology-mode', topologyMode);
  }, [topologyMode]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetails(selectedId, metricsHours);
  }, [selectedId, metricsHours]);

  useEffect(() => {
    if (!topologyWorkspaceId && topologyWorkspaces.length) {
      setTopologyWorkspaceId(topologyWorkspaces[0].id);
    }
  }, [topologyWorkspaces, topologyWorkspaceId]);

  useEffect(() => {
    if (!topologyWorkspaceId) return;
    void api.getNetworkTopologyWorkspace(topologyWorkspaceId).then(workspace => {
      setTopologyWorkspaceName(workspace.name);
      setTopologyWorkspaceDescription(workspace.description);
      setTopologyBranchCode(workspace.branchCode);
      setTopologyLayout(workspace.layout);
      setTopologyDirty(false);
      setTopologyLinkStartId('');
      setTopologyConnecting(false);
    }).catch(error => {
      console.error('Ağ mimarisi yüklenemedi:', error);
    });
  }, [topologyWorkspaceId]);


  const selected = useMemo(() => items.find(item => item.id === selectedId) ?? null, [items, selectedId]);

  const sorted = useMemo(() => {
    const q = query.toLocaleLowerCase('tr-TR').trim();
    return [...items]
      .filter(item => !q || [
        item.name, item.host, item.description, item.deviceType, DEVICE_LABELS[item.deviceType],
        item.vendor, item.location, item.branchCode, item.status,
      ].join(' ').toLocaleLowerCase('tr-TR').includes(q))
      .sort((a, b) => {
        const rank = (status: string) => status === 'OFFLINE' ? 0 : status === 'UNKNOWN' ? 1 : 2;
        return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'tr');
      });
  }, [items, query]);

  const reset = () => {
    setEditingId(null);
    setBranchCode(defaultRecordBranch(branches));
    setForm(EMPTY);
  };

  const edit = (item: NetworkMonitor) => {
    setEditingId(item.id);
    setBranchCode(item.branchCode);
    setForm({
      name: item.name,
      host: item.host,
      description: item.description,
      deviceType: item.deviceType,
      vendor: item.vendor,
      location: item.location,
      operatingSystem: item.operatingSystem,
      snmpEnabled: item.snmpEnabled,
      snmpVersion: item.snmpVersion,
      snmpPort: item.snmpPort,
      snmpCommunity: '',
      snmpUsername: item.snmpUsername,
      snmpAuthProtocol: item.snmpAuthProtocol,
      snmpAuthKey: '',
      snmpPrivProtocol: item.snmpPrivProtocol,
      snmpPrivKey: '',
      intervalSeconds: item.intervalSeconds,
      failureThreshold: item.failureThreshold,
      timeoutMs: item.timeoutMs,
      emailTo: item.emailTo,
      downSubject: item.downSubject,
      downBody: item.downBody,
      upSubject: item.upSubject,
      upBody: item.upBody,
      active: item.active,
      positionX: item.positionX,
      positionY: item.positionY,
    });
    setTab('devices');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    if (!editingId && !branchCode) {
      alert('Kayıt yapılacak şubeyi seçin.');
      return;
    }
    setBusy(true);
    try {
      if (editingId) await api.updateNetworkMonitor(editingId, form);
      else await api.createNetworkMonitor({ ...form, branchCode });
      reset();
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Network tanımı kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: NetworkMonitor) => {
    if (!confirm(`${item.name} (${item.host}) network izleme tanımı silinsin mi? Servis ve geçmiş kayıtları da silinir.`)) return;
    await api.deleteNetworkMonitor(item.id);
    if (selectedId === item.id) setSelectedId('');
    await load();
  };

  const test = async (item: NetworkMonitor) => {
    setBusy(true);
    try {
      const result = await api.testNetworkMonitor(item.id);
      alert(result.status === 'ONLINE'
        ? `${item.name}: ERİŞİM VAR${result.lastLatencyMs ? ` (${result.lastLatencyMs} ms)` : ''}`
        : `${item.name}: ERİŞİM YOK / Ping başarısız. Ardışık hata: ${result.consecutiveFailures}/${result.failureThreshold}`);
      await load();
      if (selectedId === item.id) await loadDetails(item.id, metricsHours);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Ping testi yapılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const loadDetails = async (id: string, hours: number) => {
    const [nextEvents, nextMetrics, nextServices, nextSnmp] = await Promise.all([
      api.getNetworkMonitorEvents(id),
      api.getNetworkMetrics(id, hours),
      api.getNetworkServices(id),
      api.getNetworkSnmp(id, hours).catch(() => null),
    ]);
    setEvents(nextEvents);
    setMetrics(nextMetrics);
    setServices(nextServices);
    setSnmpData(nextSnmp);
  };

  const openDetails = async (item: NetworkMonitor) => {
    setSelectedId(item.id);
    setServiceEditingId(null);
    setServiceForm(EMPTY_SERVICE);
    await loadDetails(item.id, metricsHours);
  };

  const saveService = async () => {
    if (!selectedId) return;
    if (!serviceForm.name.trim()) {
      alert('Servis adı zorunludur.');
      return;
    }
    setBusy(true);
    try {
      if (serviceEditingId) await api.updateNetworkService(serviceEditingId, serviceForm);
      else await api.createNetworkService(selectedId, serviceForm);
      setServiceEditingId(null);
      setServiceForm(EMPTY_SERVICE);
      await loadDetails(selectedId, metricsHours);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Servis kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const editService = (service: NetworkService) => {
    setServiceEditingId(service.id);
    setServiceForm({
      name: service.name,
      protocol: service.protocol,
      port: service.port,
      path: service.path,
      expectedStatus: service.expectedStatus,
      timeoutMs: service.timeoutMs,
      active: service.active,
    });
  };

  const deleteService = async (service: NetworkService) => {
    if (!confirm(`${service.name} servisi silinsin mi?`)) return;
    await api.deleteNetworkService(service.id);
    if (selectedId) await loadDetails(selectedId, metricsHours);
    await load();
  };

  const testService = async (service: NetworkService) => {
    setBusy(true);
    try {
      const result = await api.testNetworkService(service.id);
      alert(`${service.name}: ${result.success ? 'SERVİS VAR' : 'SERVİS YOK'} · ${result.message}${result.latencyMs ? ` · ${result.latencyMs} ms` : ''}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Servis testi yapılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const discover = async () => {
    if (!discoverBranch) {
      alert('Keşif yapılacak şubeyi seçin.');
      return;
    }
    setBusy(true);
    setDiscoveryInfo('Ağ taranıyor. Yalnız gerçek ICMP Echo Reply veren cihazlar listelenecek…');
    setDiscoveryResults([]);
    setSelectedDiscovery(new Set());
    try {
      const result = await api.discoverNetwork({ cidr, timeoutMs: discoverTimeout, branchCode: discoverBranch });
      setDiscoveryResults(result.results);
      setSelectedDiscovery(new Set(result.results.filter(item => !item.alreadyMonitored).map(item => item.ip)));
      setDiscoveryInfo(`${result.scanned.toLocaleString('tr-TR')} IP tarandı · ${result.found.toLocaleString('tr-TR')} erişilebilir cihaz bulundu.`);
    } catch (error) {
      setDiscoveryInfo(error instanceof Error ? error.message : 'Ağ keşfi başarısız.');
    } finally {
      setBusy(false);
    }
  };

  const addDiscovered = async () => {
    const selectedRows = discoveryResults.filter(row => selectedDiscovery.has(row.ip) && !row.alreadyMonitored);
    if (!selectedRows.length) {
      alert('İzlemeye eklenecek cihaz seçin.');
      return;
    }
    setBusy(true);
    try {
      let created = 0;
      for (let index = 0; index < selectedRows.length; index += 1) {
        const row = selectedRows[index];
        await api.createNetworkMonitor({
          ...EMPTY,
          branchCode: discoverBranch,
          host: row.ip,
          name: row.hostname || `Cihaz ${row.ip}`,
          description: row.hostname ? `Ağ keşfi ile bulundu: ${row.hostname}` : 'Ağ keşfi ile bulundu.',
          deviceType: (DEVICE_LABELS[row.deviceType] ? row.deviceType : 'UNKNOWN') as NetworkMonitor['deviceType'],
          operatingSystem: ['ROUTER','SWITCH','ACCESS_POINT','FIREWALL'].includes(row.deviceType) ? 'NETWORK' : 'UNKNOWN',
          positionX: 10 + ((index * 17) % 80),
          positionY: 10 + ((index * 23) % 80),
        });
        created += 1;
      }
      alert(`${created} cihaz Network İzleme listesine eklendi.`);
      await load();
      setTab('devices');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Keşfedilen cihazlar eklenemedi.');
    } finally {
      setBusy(false);
    }
  };

  const testSnmp = async (item: NetworkMonitor) => {
    setSnmpBusy(true);
    try {
      const result = await api.testNetworkSnmp(item.id);
      alert(
        `SNMP başarılı · ${result.sysName || item.name}\n` +
        `CPU: ${result.cpuPercent ?? '-'}% · RAM: ${result.memoryPercent ?? '-'}% · Disk: ${result.diskPercent ?? '-'}%\n` +
        `Interface: ${result.interfaces.length}`,
      );
      setSnmpData(await api.getNetworkSnmp(item.id, metricsHours));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'SNMP testi başarısız.');
    } finally {
      setSnmpBusy(false);
    }
  };

  const openRemoteMenu = (event: React.MouseEvent, item: NetworkMonitor) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - 260)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - 220)),
      item,
    });
  };

  const openRdp = (item: NetworkMonitor) => {
    window.open(api.getNetworkRdpUrl(item.id), '_blank', 'noopener,noreferrer');
    setContextMenu(null);
  };

  const openSsh = (item: NetworkMonitor) => {
    const sshPort = item.services?.find(service => service.protocol === 'SSH')?.port ?? 22;
    window.location.href = `ssh://${encodeURIComponent(item.host)}:${sshPort}`;
    setContextMenu(null);
  };

  const copyPuttyCommand = async (item: NetworkMonitor) => {
    const sshPort = item.services?.find(service => service.protocol === 'SSH')?.port ?? 22;
    await navigator.clipboard.writeText(`putty.exe -ssh ${item.host} -P ${sshPort}`);
    alert(`PuTTY komutu panoya kopyalandı:\nputty.exe -ssh ${item.host} -P ${sshPort}`);
    setContextMenu(null);
  };

  const formatBps = (value: number | null) => {
    if (value == null || !Number.isFinite(value)) return '—';
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gbps`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)} Kbps`;
    return `${Math.round(value)} bps`;
  };

  const topologyId = (prefix: string) =>
    `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

  const createTopologyWorkspace = async () => {
    if (!topologyWorkspaceName.trim()) {
      alert('Ağ mimarisi çalışma alanı adı zorunludur.');
      return;
    }
    if (!topologyBranchCode) {
      alert('Ağ mimarisi için şube seçin.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.createNetworkTopologyWorkspace({
        branchCode: topologyBranchCode,
        name: topologyWorkspaceName.trim(),
        description: topologyWorkspaceDescription.trim(),
        layout: { ...EMPTY_TOPOLOGY_LAYOUT, nodes: [], links: [], settings: { ...EMPTY_TOPOLOGY_LAYOUT.settings } },
      });
      await load();
      setTopologyWorkspaceId(created.id);
      setTopologyLayout(created.layout);
      setTopologyEditing(true);
      setTopologyDirty(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Ağ mimarisi çalışma alanı oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  };

  const saveTopologyWorkspace = async () => {
    if (!topologyWorkspaceId) {
      await createTopologyWorkspace();
      return;
    }
    setBusy(true);
    try {
      const updated = await api.updateNetworkTopologyWorkspace(topologyWorkspaceId, {
        name: topologyWorkspaceName.trim(),
        description: topologyWorkspaceDescription.trim(),
        layout: topologyLayout,
      });
      setTopologyLayout(updated.layout);
      setTopologyDirty(false);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Ağ mimarisi kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const deleteTopologyWorkspace = async () => {
    if (!topologyWorkspaceId) return;
    if (!confirm(`“${topologyWorkspaceName}” ağ mimarisi silinsin mi?`)) return;
    setBusy(true);
    try {
      await api.deleteNetworkTopologyWorkspace(topologyWorkspaceId);
      setTopologyWorkspaceId('');
      setTopologyWorkspaceName('Ana Ağ Mimarisi');
      setTopologyWorkspaceDescription('');
      setTopologyLayout({ ...EMPTY_TOPOLOGY_LAYOUT, nodes: [], links: [], settings: { ...EMPTY_TOPOLOGY_LAYOUT.settings } });
      setTopologyDirty(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const addMonitorToTopology = (item: NetworkMonitor) => {
    if (topologyLayout.nodes.some(node => node.monitorId === item.id)) return;
    const count = topologyLayout.nodes.length;
    const node: NetworkTopologyNode = {
      id: topologyId('device'),
      kind: 'DEVICE',
      monitorId: item.id,
      label: item.name,
      subtitle: `${item.host} · ${DEVICE_LABELS[item.deviceType]}`,
      x: 80 + (count % 6) * 230,
      y: 80 + Math.floor(count / 6) * 150,
      width: 180,
      height: 82,
    };
    setTopologyLayout(current => ({ ...current, nodes: [...current.nodes, node] }));
    setTopologyDirty(true);
  };

  const addCustomTopologyNode = (kind: NetworkTopologyNodeKind) => {
    const label = topologyNewLabel.trim() || TOPOLOGY_KIND_LABELS[kind];
    const count = topologyLayout.nodes.length;
    const node: NetworkTopologyNode = {
      id: topologyId(kind.toLowerCase()),
      kind,
      monitorId: null,
      label,
      subtitle: kind === 'NOTE' ? 'Açıklama / not alanı' : '',
      x: 110 + (count % 6) * 230,
      y: 110 + Math.floor(count / 6) * 150,
      width: kind === 'NOTE' || kind === 'LOCATION' ? 210 : 150,
      height: kind === 'NOTE' ? 110 : 76,
    };
    setTopologyLayout(current => ({ ...current, nodes: [...current.nodes, node] }));
    setTopologyNewLabel('');
    setTopologyDirty(true);
  };

  const removeTopologyNode = (nodeId: string) => {
    setTopologyLayout(current => ({
      ...current,
      nodes: current.nodes.filter(node => node.id !== nodeId),
      links: current.links.filter(link => link.from !== nodeId && link.to !== nodeId),
    }));
    setTopologyLinkStartId(current => current === nodeId ? '' : current);
    setTopologyDirty(true);
  };

  const removeTopologyLink = (linkId: string) => {
    setTopologyLayout(current => ({ ...current, links: current.links.filter(link => link.id !== linkId) }));
    setTopologyDirty(true);
  };

  const handleTopologyNodeClick = (node: NetworkTopologyNode) => {
    if (topologyEditing && topologyConnecting) {
      if (!topologyLinkStartId) {
        setTopologyLinkStartId(node.id);
        return;
      }
      if (topologyLinkStartId === node.id) {
        setTopologyLinkStartId('');
        return;
      }
      const exists = topologyLayout.links.some(link =>
        (link.from === topologyLinkStartId && link.to === node.id) ||
        (link.from === node.id && link.to === topologyLinkStartId)
      );
      if (!exists) {
        setTopologyLayout(current => ({
          ...current,
          links: [...current.links, {
            id: topologyId('link'),
            from: topologyLinkStartId,
            to: node.id,
            label: '',
            style: 'SOLID',
          }],
        }));
        setTopologyDirty(true);
      }
      setTopologyLinkStartId('');
      return;
    }

    if (node.monitorId) {
      const monitor = items.find(item => item.id === node.monitorId);
      if (monitor) void openDetails(monitor);
    }
  };

  const topologyDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!topologyEditing || !topologyDraggingNodeId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const zoom = topologyLayout.settings.zoom || 1;
    const rawX = (event.clientX - rect.left + event.currentTarget.scrollLeft) / zoom;
    const rawY = (event.clientY - rect.top + event.currentTarget.scrollTop) / zoom;
    const snap = topologyLayout.settings.snap ? 20 : 1;
    const x = Math.max(0, Math.min(topologyLayout.settings.width - 80, Math.round(rawX / snap) * snap));
    const y = Math.max(0, Math.min(topologyLayout.settings.height - 50, Math.round(rawY / snap) * snap));
    setTopologyLayout(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === topologyDraggingNodeId ? { ...node, x, y } : node),
    }));
    setTopologyDraggingNodeId('');
    setTopologyDirty(true);
  };

  const autoLayoutTopology = () => {
    const columns = Math.max(1, Math.floor(Math.sqrt(Math.max(1, topologyLayout.nodes.length))));
    setTopologyLayout(current => ({
      ...current,
      nodes: current.nodes.map((node, index) => ({
        ...node,
        x: 100 + (index % columns) * 250,
        y: 100 + Math.floor(index / columns) * 160,
      })),
    }));
    setTopologyDirty(true);
  };

  const updateTopologyZoom = (delta: number) => {
    setTopologyLayout(current => ({
      ...current,
      settings: {
        ...current.settings,
        zoom: Math.max(0.4, Math.min(2, Number((current.settings.zoom + delta).toFixed(2)))),
      },
    }));
    setTopologyDirty(true);
  };

  const networkExcelCell = (row: Record<string, unknown>, names: string[]): string => {
    for (const name of names) {
      const value = row[name];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };

  const networkExcelNumber = (
    row: Record<string, unknown>,
    names: string[],
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const raw = networkExcelCell(row, names);
    if (!raw) return fallback;
    const normalized = raw.replace(',', '.');
    const value = Number(normalized);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value)));
  };

  const networkExcelBool = (value: string, fallback: boolean): boolean => {
    const normalized = value.trim().toLocaleLowerCase('tr-TR');
    if (!normalized) return fallback;
    if (['evet', 'e', '1', 'true', 'aktif', 'açık', 'acik', 'yes'].includes(normalized)) return true;
    if (['hayır', 'hayir', 'h', '0', 'false', 'pasif', 'kapalı', 'kapali', 'no'].includes(normalized)) return false;
    return fallback;
  };

  const networkExcelDeviceType = (value: string): NetworkMonitor['deviceType'] => {
    const normalized = value.trim().toLocaleLowerCase('tr-TR');
    if (['router', 'yönlendirici', 'yonlendirici'].includes(normalized)) return 'ROUTER';
    if (['switch', 'anahtar'].includes(normalized)) return 'SWITCH';
    if (['server', 'sunucu'].includes(normalized)) return 'SERVER';
    if (['computer', 'bilgisayar', 'pc', 'istemci'].includes(normalized)) return 'COMPUTER';
    if (['printer', 'yazıcı', 'yazici'].includes(normalized)) return 'PRINTER';
    if (['access point', 'access_point', 'ap', 'erişim noktası', 'erisim noktasi'].includes(normalized)) return 'ACCESS_POINT';
    if (['firewall', 'güvenlik duvarı', 'guvenlik duvari'].includes(normalized)) return 'FIREWALL';
    if (['other', 'diğer', 'diger'].includes(normalized)) return 'OTHER';
    return 'UNKNOWN';
  };

  const networkExcelOperatingSystem = (value: string): NetworkMonitor['operatingSystem'] => {
    const normalized = value.trim().toLocaleLowerCase('tr-TR');
    if (normalized.includes('windows')) return 'WINDOWS';
    if (['linux', 'ubuntu', 'debian', 'centos', 'redhat', 'red hat', 'rhel'].some(item => normalized.includes(item))) return 'LINUX';
    if (['network', 'ağ', 'ag', 'ios', 'routeros', 'fortios'].some(item => normalized.includes(item))) return 'NETWORK';
    if (['other', 'diğer', 'diger'].includes(normalized)) return 'OTHER';
    return 'UNKNOWN';
  };

  const exportNetworkDevicesExcel = () => {
    const rows = sorted.map(item => ({
      'Şube Kodu': item.branchCode,
      'Cihaz Adı': item.name,
      'IP / Hostname': item.host,
      'Cihaz Tipi': DEVICE_LABELS[item.deviceType] ?? item.deviceType,
      'İşletim Sistemi': item.operatingSystem === 'WINDOWS' ? 'Windows'
        : item.operatingSystem === 'LINUX' ? 'Linux'
        : item.operatingSystem === 'NETWORK' ? 'Network Cihazı'
        : item.operatingSystem === 'OTHER' ? 'Diğer' : 'Bilinmiyor',
      'Üretici': item.vendor,
      'Lokasyon': item.location,
      'Açıklama': item.description,
      'Durum': statusText(item.status),
      'Son Gecikme (ms)': item.lastLatencyMs ?? '',
      'Ardışık Hata': item.consecutiveFailures,
      'Başarısız Tekrar Eşiği': item.failureThreshold,
      'Ping Aralığı (sn)': item.intervalSeconds,
      'Ping Timeout (ms)': item.timeoutMs,
      'Son Kontrol': item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString('tr-TR') : '',
      'Son Başarılı Erişim': item.lastSuccessAt ? new Date(item.lastSuccessAt).toLocaleString('tr-TR') : '',
      'Son Başarısız Erişim': item.lastFailureAt ? new Date(item.lastFailureAt).toLocaleString('tr-TR') : '',
      'Bildirim E-postaları': item.emailTo,
      'SNMP Aktif': item.snmpEnabled ? 'Evet' : 'Hayır',
      'SNMP Sürümü': item.snmpVersion,
      'SNMP Portu': item.snmpPort,
      'SNMP Community Kayıtlı': item.snmpCommunitySet ? 'Evet' : 'Hayır',
      'SNMP Kullanıcı': item.snmpUsername,
      'SNMP Auth Protokolü': item.snmpAuthProtocol,
      'SNMP Auth Anahtarı Kayıtlı': item.snmpAuthKeySet ? 'Evet' : 'Hayır',
      'SNMP Privacy Protokolü': item.snmpPrivProtocol,
      'SNMP Privacy Anahtarı Kayıtlı': item.snmpPrivKeySet ? 'Evet' : 'Hayır',
      'İzleme Aktif': item.active ? 'Evet' : 'Hayır',
      'Harita X': item.positionX,
      'Harita Y': item.positionY,
      'Erişim Yok Mail Konusu': item.downSubject,
      'Erişim Yok Mail Açıklaması': item.downBody,
      'Erişim Var Mail Konusu': item.upSubject,
      'Erişim Var Mail Açıklaması': item.upBody,
      'Oluşturan': item.createdByName,
      'Oluşturma Tarihi': new Date(item.createdAt).toLocaleString('tr-TR'),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Bilgi: 'Network izleme cihazı bulunamadı.' }]);
    worksheet['!cols'] = [
      { wch: 12 }, { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 18 },
      { wch: 18 }, { wch: 22 }, { wch: 36 }, { wch: 16 }, { wch: 16 },
      { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 22 },
      { wch: 22 }, { wch: 22 }, { wch: 34 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 18 },
      { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 34 },
      { wch: 50 }, { wch: 34 }, { wch: 50 }, { wch: 24 }, { wch: 22 },
    ];
    worksheet['!autofilter'] = { ref: worksheet['!ref'] || 'A1:A1' };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Network Cihazları');
    XLSX.writeFile(workbook, `operis-network-cihazlari-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const downloadNetworkImportTemplate = () => {
    const rows = [{
      'Şube Kodu': defaultRecordBranch(branches) || '100',
      'Cihaz Adı': 'Örnek Ana Switch',
      'IP / Hostname': '10.20.128.10',
      'Cihaz Tipi': 'Switch',
      'İşletim Sistemi': 'Network Cihazı',
      'Üretici': 'Cisco',
      'Lokasyon': 'Merkez Sistem Odası',
      'Açıklama': 'Network izleme toplu aktarım örneği',
      'Ping Aralığı (sn)': 60,
      'Başarısız Tekrar Eşiği': 3,
      'Ping Timeout (ms)': 2000,
      'Bildirim E-postaları': 'bilgiislem@firma.com',
      'SNMP Aktif': 'Hayır',
      'SNMP Sürümü': '2c',
      'SNMP Portu': 161,
      'SNMP Community': '',
      'SNMP Kullanıcı': '',
      'SNMP Auth Protokolü': 'SHA',
      'SNMP Auth Anahtarı': '',
      'SNMP Privacy Protokolü': 'AES',
      'SNMP Privacy Anahtarı': '',
      'İzleme Aktif': 'Evet',
      'Harita X': 20,
      'Harita Y': 20,
      'Erişim Yok Mail Konusu': '[Operis] {name} - ERİŞİM YOK',
      'Erişim Yok Mail Açıklaması': '{name} ({host}) adresine erişim sağlanamıyor. Zaman: {time}',
      'Erişim Var Mail Konusu': '[Operis] {name} - ERİŞİM VAR',
      'Erişim Var Mail Açıklaması': '{name} ({host}) adresine erişim yeniden sağlandı. Zaman: {time}',
    }];

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 12 }, { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 18 },
      { wch: 18 }, { wch: 24 }, { wch: 36 }, { wch: 18 }, { wch: 22 },
      { wch: 18 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 24 },
      { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 36 },
      { wch: 52 }, { wch: 36 }, { wch: 52 },
    ];

    const info = XLSX.utils.aoa_to_sheet([
      ['OPERİS NETWORK İZLEME TOPLU AKTARIM ŞABLONU'],
      ['Cihaz Tipi seçenekleri', 'Router, Switch, Sunucu, Bilgisayar, Yazıcı, Access Point, Firewall, Diğer'],
      ['İşletim Sistemi seçenekleri', 'Windows, Linux, Network Cihazı, Diğer, Bilinmiyor'],
      ['Evet/Hayır alanları', 'Evet veya Hayır yazılmalıdır.'],
      ['Şube Kodu', 'Kullanıcının yetkili olduğu üç haneli şube kodu girilmelidir.'],
      ['IP / Hostname', 'Aynı şubede aynı IP/Hostname ikinci kez eklenmez.'],
      ['SNMP gizli alanları', 'Community/Auth/Privacy değerleri yalnız içeri aktarmada kullanılır; dışarı aktarımda güvenlik nedeniyle açık olarak verilmez.'],
    ]);
    info['!cols'] = [{ wch: 30 }, { wch: 100 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Network Cihazları');
    XLSX.utils.book_append_sheet(workbook, info, 'Açıklamalar');
    XLSX.writeFile(workbook, 'operis-network-toplu-aktarim-sablonu.xlsx');
  };

  const importNetworkDevicesExcel = async (file: File) => {
    setNetworkExcelImporting(true);
    setNetworkExcelImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const sheetName = workbook.SheetNames.find(name => name.toLocaleLowerCase('tr-TR').includes('network'))
        ?? workbook.SheetNames[0];

      if (!sheetName) throw new Error('Excel dosyasında çalışma sayfası bulunamadı.');

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });
      if (!rows.length) throw new Error('Excel dosyasında aktarılacak cihaz kaydı bulunamadı.');

      const authorizedBranches = new Set(branches.map(branch => branch.code));
      const existingKeys = new Set(items.map(item => `${item.branchCode}|${item.host.trim().toLocaleLowerCase('tr-TR')}`));
      const fileKeys = new Set<string>();
      const errors: string[] = [];
      let imported = 0;
      let skipped = 0;

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const rowNo = index + 2;
        const rowBranch = networkExcelCell(row, ['Şube Kodu', 'Sube Kodu', 'Şube', 'Sube']) || branchCode || defaultRecordBranch(branches);
        const name = networkExcelCell(row, ['Cihaz Adı', 'Cihaz Adi', 'Ad', 'Name']);
        const host = networkExcelCell(row, ['IP / Hostname', 'IP', 'Hostname', 'Host']);

        if (!rowBranch || !/^\d{3}$/.test(rowBranch)) {
          errors.push(`Satır ${rowNo}: Geçerli üç haneli Şube Kodu bulunamadı.`);
          skipped += 1;
          continue;
        }
        if (!authorizedBranches.has(rowBranch)) {
          errors.push(`Satır ${rowNo}: ${rowBranch} şubesi için yetkiniz yok.`);
          skipped += 1;
          continue;
        }
        if (!name) {
          errors.push(`Satır ${rowNo}: Cihaz Adı zorunludur.`);
          skipped += 1;
          continue;
        }
        if (!host) {
          errors.push(`Satır ${rowNo}: IP / Hostname zorunludur.`);
          skipped += 1;
          continue;
        }

        const key = `${rowBranch}|${host.toLocaleLowerCase('tr-TR')}`;
        if (existingKeys.has(key)) {
          errors.push(`Satır ${rowNo}: ${rowBranch} / ${host} zaten OPERİS'te kayıtlı.`);
          skipped += 1;
          continue;
        }
        if (fileKeys.has(key)) {
          errors.push(`Satır ${rowNo}: Excel içinde ${rowBranch} / ${host} tekrarlı.`);
          skipped += 1;
          continue;
        }
        fileKeys.add(key);

        const deviceType = networkExcelDeviceType(networkExcelCell(row, ['Cihaz Tipi', 'Tip', 'Device Type']));
        const operatingSystem = networkExcelOperatingSystem(networkExcelCell(row, ['İşletim Sistemi', 'Isletim Sistemi', 'OS']));
        const snmpVersionRaw = networkExcelCell(row, ['SNMP Sürümü', 'SNMP Surumu', 'SNMP Version']).toLocaleLowerCase('tr-TR');
        const snmpVersion: NetworkMonitor['snmpVersion'] = snmpVersionRaw.includes('3') ? '3' : '2c';
        const snmpAuthRaw = networkExcelCell(row, ['SNMP Auth Protokolü', 'SNMP Auth Protokolu']).toUpperCase();
        const snmpAuthProtocol: NetworkMonitor['snmpAuthProtocol'] = snmpAuthRaw === 'MD5' ? 'MD5' : 'SHA';
        const snmpPrivRaw = networkExcelCell(row, ['SNMP Privacy Protokolü', 'SNMP Privacy Protokolu']).toUpperCase();
        const snmpPrivProtocol: NetworkMonitor['snmpPrivProtocol'] = snmpPrivRaw === 'DES' ? 'DES' : 'AES';

        try {
          await api.createNetworkMonitor({
            branchCode: rowBranch,
            name,
            host,
            description: networkExcelCell(row, ['Açıklama', 'Aciklama', 'Description']),
            deviceType,
            vendor: networkExcelCell(row, ['Üretici', 'Uretici', 'Vendor']),
            location: networkExcelCell(row, ['Lokasyon', 'Location']),
            operatingSystem,
            snmpEnabled: networkExcelBool(networkExcelCell(row, ['SNMP Aktif', 'SNMP Active']), false),
            snmpVersion,
            snmpPort: networkExcelNumber(row, ['SNMP Portu', 'SNMP Port'], 161, 1, 65535),
            snmpCommunity: networkExcelCell(row, ['SNMP Community', 'Community']),
            snmpUsername: networkExcelCell(row, ['SNMP Kullanıcı', 'SNMP Kullanici', 'SNMP Username']),
            snmpAuthProtocol,
            snmpAuthKey: networkExcelCell(row, ['SNMP Auth Anahtarı', 'SNMP Auth Anahtari', 'SNMP Auth Key']),
            snmpPrivProtocol,
            snmpPrivKey: networkExcelCell(row, ['SNMP Privacy Anahtarı', 'SNMP Privacy Anahtari', 'SNMP Priv Key']),
            intervalSeconds: networkExcelNumber(row, ['Ping Aralığı (sn)', 'Ping Araligi (sn)', 'Ping Aralığı'], 60, 10, 86400),
            failureThreshold: networkExcelNumber(row, ['Başarısız Tekrar Eşiği', 'Basarisiz Tekrar Esigi'], 3, 1, 100),
            timeoutMs: networkExcelNumber(row, ['Ping Timeout (ms)', 'Ping Timeout'], 2000, 500, 10000),
            emailTo: networkExcelCell(row, ['Bildirim E-postaları', 'Bildirim E-postalari', 'E-posta']),
            downSubject: networkExcelCell(row, ['Erişim Yok Mail Konusu', 'Erisim Yok Mail Konusu']) || '[Operis] {name} - ERİŞİM YOK',
            downBody: networkExcelCell(row, ['Erişim Yok Mail Açıklaması', 'Erisim Yok Mail Aciklamasi']) || '{name} ({host}) adresine erişim sağlanamıyor.\nZaman: {time}',
            upSubject: networkExcelCell(row, ['Erişim Var Mail Konusu', 'Erisim Var Mail Konusu']) || '[Operis] {name} - ERİŞİM VAR',
            upBody: networkExcelCell(row, ['Erişim Var Mail Açıklaması', 'Erisim Var Mail Aciklamasi']) || '{name} ({host}) adresine erişim yeniden sağlandı.\nZaman: {time}',
            active: networkExcelBool(networkExcelCell(row, ['İzleme Aktif', 'Izleme Aktif', 'Aktif']), true),
            positionX: networkExcelNumber(row, ['Harita X', 'X'], 20, 0, 100),
            positionY: networkExcelNumber(row, ['Harita Y', 'Y'], 20, 0, 100),
          });
          existingKeys.add(key);
          imported += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Bilinmeyen kayıt hatası';
          errors.push(`Satır ${rowNo}: ${name} (${host}) eklenemedi: ${message}`);
          skipped += 1;
        }
      }

      setNetworkExcelImportResult({
        totalRows: rows.length,
        imported,
        skipped,
        errors: errors.slice(0, 100),
      });
      await load();
    } catch (error) {
      setNetworkExcelImportResult({
        totalRows: 0,
        imported: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'Excel toplu aktarım başarısız.'],
      });
    } finally {
      setNetworkExcelImporting(false);
    }
  };

  const statusText = (status: string) => status === 'ONLINE' ? 'ERİŞİM VAR' : status === 'OFFLINE' ? 'ERİŞİM YOK' : 'BEKLENİYOR';

  if (!can('canView')) return <div className="panel-card">Network İzleme görüntüleme yetkiniz yok.</div>;

  return (
    <div className="space-y-4">
      <section className="panel-card network-monitor-header">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black"><Network className="h-5 w-5" /> OPERİS Network İzleme</h2>
            <p className="mt-1 text-sm opacity-70">Cihaz keşfi, gerçek ICMP kontrolü, servis/port izleme, uptime-downtime, performans grafikleri, alarm ve topoloji.</p>
          </div>
          <button onClick={() => void load()} className="ui-button ui-button-neutral"><RefreshCw className="h-4 w-4" /> Yenile</button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</TabButton>
          <TabButton active={tab === 'devices'} onClick={() => setTab('devices')}>Cihazlar</TabButton>
          <TabButton active={tab === 'discovery'} onClick={() => setTab('discovery')}>Cihaz Keşfi</TabButton>
          <TabButton active={tab === 'topology'} onClick={() => setTab('topology')}>Ağ Haritası</TabButton>
        </div>
      </section>

      {tab === 'dashboard' && (
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Toplam Cihaz" value={summary.total} subtitle={`${summary.active} aktif izleme`} />
            <StatCard title="Erişilebilir" value={summary.online} subtitle="ICMP başarılı" tone="online" />
            <StatCard title="Erişilemiyor" value={summary.offline} subtitle="Alarm gerektirir" tone="offline" />
            <StatCard title="Servis Alarmı" value={summary.servicesOffline} subtitle={`${summary.servicesTotal} servis izleniyor`} tone={summary.servicesOffline ? 'warning' : 'online'} />
            <StatCard title="Ort. Gecikme" value={`${summary.averageLatencyMs} ms`} subtitle={`${summary.alarms24h} alarm / 24 saat`} />
          </section>

          <section className="panel-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-black"><AlertTriangle className="h-4 w-4" /> Son Alarmlar</h3>
              <span className="text-xs opacity-60">Son 24 saat</span>
            </div>
            {summary.recentAlarms.length ? (
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900"><tr><th className="p-2 text-left">Zaman</th><th className="p-2 text-left">Cihaz</th><th className="p-2 text-left">Alarm</th></tr></thead>
                  <tbody>{summary.recentAlarms.map(alarm => {
                    const monitor = items.find(item => item.id === alarm.monitorId);
                    return <tr key={alarm.id} className="border-t border-slate-800">
                      <td className="p-2 text-xs">{new Date(alarm.createdAt).toLocaleString('tr-TR')}</td>
                      <td className="p-2 font-bold">{monitor?.name ?? alarm.monitorId}</td>
                      <td className="p-2 text-red-200">{alarm.message}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            ) : <p className="py-8 text-center opacity-60">Son 24 saatte alarm yok.</p>}
          </section>

          <section className="panel-card">
            <h3 className="mb-3 font-black">Cihaz Sağlığı</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sorted.slice(0, 12).map(item => <DeviceCard key={item.id} item={item} canTest={can('canExcel')} busy={busy} onTest={test} onDetails={openDetails} onEdit={edit} canEdit={can('canEdit')} />)}
            </div>
            {!items.length && <p className="py-8 text-center opacity-60">Henüz izlenen cihaz yok.</p>}
          </section>
        </div>
      )}

      {tab === 'devices' && (
        <div className="space-y-4">
          {(can('canCreate') || (editingId && can('canEdit'))) && (
            <section className="panel-card">
              <h3 className="mb-3 font-bold">{editingId ? 'Cihazı Düzenle' : 'Yeni Cihaz Ekle'}</h3>
              <BranchRecordSelector
                branches={branches}
                value={editingId ? (items.find(item => item.id === editingId)?.branchCode ?? branchCode) : branchCode}
                onChange={setBranchCode}
                disabled={Boolean(editingId)}
                className="mb-3"
              />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Cihaz Adı"><input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} placeholder="Ana Switch" /></Field>
                <Field label="IP / Hostname"><input value={form.host} onChange={e => setForm(v => ({ ...v, host: e.target.value }))} placeholder="10.20.128.1" /></Field>
                <Field label="Cihaz Tipi">
                  <select value={form.deviceType} onChange={e => setForm(v => ({ ...v, deviceType: e.target.value as NetworkMonitor['deviceType'] }))}>
                    {Object.entries(DEVICE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Üretici"><input value={form.vendor} onChange={e => setForm(v => ({ ...v, vendor: e.target.value }))} placeholder="Cisco, HP, Fortinet..." /></Field>
                <Field label="Lokasyon"><input value={form.location} onChange={e => setForm(v => ({ ...v, location: e.target.value }))} placeholder="DC-1, Kat 2..." /></Field>
                <Field label="İşletim Sistemi">
                  <select value={form.operatingSystem} onChange={e => setForm(v => ({ ...v, operatingSystem: e.target.value as NetworkMonitor['operatingSystem'] }))}>
                    <option value="UNKNOWN">Bilinmiyor</option>
                    <option value="WINDOWS">Windows</option>
                    <option value="LINUX">Linux</option>
                    <option value="NETWORK">Network Cihazı</option>
                    <option value="OTHER">Diğer</option>
                  </select>
                </Field>
                <Field label="Ping Aralığı (sn)"><input type="number" min={10} max={86400} value={form.intervalSeconds} onChange={e => setForm(v => ({ ...v, intervalSeconds: Number(e.target.value) }))} /></Field>
                <Field label="Başarısız Tekrar Eşiği"><input type="number" min={1} max={100} value={form.failureThreshold} onChange={e => setForm(v => ({ ...v, failureThreshold: Number(e.target.value) }))} /></Field>
                <Field label="Ping Timeout (ms)"><input type="number" min={500} max={10000} step={100} value={form.timeoutMs} onChange={e => setForm(v => ({ ...v, timeoutMs: Number(e.target.value) }))} /></Field>
                <Field label="Bildirim E-postaları"><input value={form.emailTo} onChange={e => setForm(v => ({ ...v, emailTo: e.target.value }))} placeholder="noc@firma.com; bilgiislem@firma.com" /></Field>
                <Field label="Harita X (%)"><input type="number" min={0} max={100} value={form.positionX} onChange={e => setForm(v => ({ ...v, positionX: Number(e.target.value) }))} /></Field>
                <Field label="Harita Y (%)"><input type="number" min={0} max={100} value={form.positionY} onChange={e => setForm(v => ({ ...v, positionY: Number(e.target.value) }))} /></Field>
              </div>

              <Field label="Açıklama"><textarea rows={2} value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} placeholder="Cihaz görevi, lokasyon, açıklama..." /></Field>

              <details className="mt-3 rounded-xl border border-slate-700 p-3">
                <summary className="cursor-pointer font-bold">SNMP v2c / v3 Ayarları</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold">
                    <input type="checkbox" checked={form.snmpEnabled} onChange={e => setForm(v => ({ ...v, snmpEnabled: e.target.checked }))} />
                    SNMP izlemeyi etkinleştir
                  </label>
                  <Field label="SNMP Sürümü">
                    <select value={form.snmpVersion} onChange={e => setForm(v => ({ ...v, snmpVersion: e.target.value as NetworkMonitor['snmpVersion'] }))}>
                      <option value="2c">SNMP v2c</option>
                      <option value="3">SNMP v3</option>
                    </select>
                  </Field>
                  <Field label="SNMP Port"><input type="number" min={1} max={65535} value={form.snmpPort} onChange={e => setForm(v => ({ ...v, snmpPort: Number(e.target.value) }))} /></Field>
                  {form.snmpVersion === '2c' && <Field label="Community"><input type="password" value={form.snmpCommunity} onChange={e => setForm(v => ({ ...v, snmpCommunity: e.target.value }))} placeholder="Boş bırakılırsa kayıtlı değer korunur" /></Field>}
                  {form.snmpVersion === '3' && <>
                    <Field label="SNMP v3 Kullanıcı"><input value={form.snmpUsername} onChange={e => setForm(v => ({ ...v, snmpUsername: e.target.value }))} /></Field>
                    <Field label="Auth Protokolü"><select value={form.snmpAuthProtocol} onChange={e => setForm(v => ({ ...v, snmpAuthProtocol: e.target.value as NetworkMonitor['snmpAuthProtocol'] }))}><option value="SHA">SHA</option><option value="MD5">MD5</option></select></Field>
                    <Field label="Auth Anahtarı"><input type="password" value={form.snmpAuthKey} onChange={e => setForm(v => ({ ...v, snmpAuthKey: e.target.value }))} placeholder="Boş = kayıtlı değer korunur" /></Field>
                    <Field label="Privacy Protokolü"><select value={form.snmpPrivProtocol} onChange={e => setForm(v => ({ ...v, snmpPrivProtocol: e.target.value as NetworkMonitor['snmpPrivProtocol'] }))}><option value="AES">AES</option><option value="DES">DES</option></select></Field>
                    <Field label="Privacy Anahtarı"><input type="password" value={form.snmpPrivKey} onChange={e => setForm(v => ({ ...v, snmpPrivKey: e.target.value }))} placeholder="Boş = kayıtlı değer korunur" /></Field>
                  </>}
                </div>
                <p className="mt-2 text-xs opacity-65">SNMP gizli bilgileri Operis veritabanında şifreli tutulur. Switch/router için system bilgileri ve interface RX/TX; destekleyen cihazlarda CPU, RAM ve disk ölçümleri alınır.</p>
              </details>

              <details className="mt-3 rounded-xl border border-slate-700 p-3">
                <summary className="cursor-pointer font-bold">Alarm E-posta Şablonları</summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="network-mail-template">
                    <h4 className="font-bold text-red-400">ERİŞİM YOK</h4>
                    <Field label="Konu"><input value={form.downSubject} onChange={e => setForm(v => ({ ...v, downSubject: e.target.value }))} /></Field>
                    <Field label="Açıklama"><textarea rows={3} value={form.downBody} onChange={e => setForm(v => ({ ...v, downBody: e.target.value }))} /></Field>
                  </div>
                  <div className="network-mail-template">
                    <h4 className="font-bold text-emerald-400">ERİŞİM VAR</h4>
                    <Field label="Konu"><input value={form.upSubject} onChange={e => setForm(v => ({ ...v, upSubject: e.target.value }))} /></Field>
                    <Field label="Açıklama"><textarea rows={3} value={form.upBody} onChange={e => setForm(v => ({ ...v, upBody: e.target.value }))} /></Field>
                  </div>
                </div>
                <p className="mt-2 text-xs opacity-65">Değişkenler: {'{name}'} {'{host}'} {'{description}'} {'{time}'} {'{failures}'} {'{latency}'}</p>
              </details>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={e => setForm(v => ({ ...v, active: e.target.checked }))} /> İzleme aktif</label>
                <button disabled={busy || !form.name.trim() || !form.host.trim()} onClick={() => void save()} className="ui-button ui-button-primary"><Save className="h-4 w-4" /> Kaydet</button>
                {editingId && <button onClick={reset} className="ui-button ui-button-neutral"><X className="h-4 w-4" /> Vazgeç</button>}
              </div>
            </section>
          )}

          <section className="panel-card">
            <div className="mb-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-black">İzlenen Cihazlar</h3>
                  <p className="mt-1 text-xs opacity-60">Network aygıtlarını Excel ile topluca sisteme aktarabilir veya yetkili olduğunuz cihazları topluca dışarı alabilirsiniz.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {can('canExcel') && (
                    <button type="button" onClick={downloadNetworkImportTemplate} className="ui-button ui-button-neutral">
                      <FileSpreadsheet className="h-4 w-4" /> Excel Şablonu
                    </button>
                  )}
                  {can('canCreate') && can('canExcel') && (
                    <label className={`ui-button ui-button-info ${networkExcelImporting ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
                      <Upload className="h-4 w-4" />
                      {networkExcelImporting ? 'Excel Aktarılıyor…' : 'Excel’den Toplu Sisteme Aktar'}
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="hidden"
                        disabled={networkExcelImporting}
                        onChange={event => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) void importNetworkDevicesExcel(file);
                        }}
                      />
                    </label>
                  )}
                  {can('canExcel') && (
                    <button type="button" onClick={exportNetworkDevicesExcel} className="ui-button ui-button-primary">
                      <Download className="h-4 w-4" /> Toplu Excel Dışa Aktar
                    </button>
                  )}
                </div>
              </div>
              <div className="flex min-w-[280px] items-center gap-2">
                <Search className="h-4 w-4 opacity-60" />
                <input className="form-control" value={query} onChange={e => setQuery(e.target.value)} placeholder="Ad, IP, tip, üretici, lokasyon, şube ara" />
              </div>
            </div>

            {networkExcelImportResult && (
              <div className={`mb-4 rounded-xl border p-3 text-sm ${
                networkExcelImportResult.errors.length
                  ? 'border-amber-500/30 bg-amber-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/10'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <b>Network Excel Toplu Aktarım Sonucu</b>
                    <p className="mt-1 text-xs">
                      Toplam satır: {networkExcelImportResult.totalRows} ·
                      Başarıyla eklendi: {networkExcelImportResult.imported} ·
                      Atlandı/Hatalı: {networkExcelImportResult.skipped}
                    </p>
                  </div>
                  <button type="button" onClick={() => setNetworkExcelImportResult(null)} className="ui-button ui-button-icon ui-button-neutral">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {networkExcelImportResult.errors.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-auto rounded-lg bg-slate-950/30 p-2 font-mono text-xs">
                    {networkExcelImportResult.errors.map((error, index) => (
                      <div key={`${index}-${error}`} className="py-0.5">{error}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sorted.map(item => (
                <article key={item.id} className={`network-monitor-card status-${item.status.toLowerCase()}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <DeviceIcon type={item.deviceType} />
                        <h4 className="truncate font-black">{item.name}</h4>
                      </div>
                      <span className="record-branch-badge mt-1">{item.branchCode}</span>
                      <p className="font-mono text-sm">{item.host}</p>
                    </div>
                    <span className={`network-status status-${item.status.toLowerCase()}`}><CircleDot className="h-3.5 w-3.5" /> {statusText(item.status)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[11px] opacity-75">
                    <span className="rounded bg-slate-800 px-2 py-1">{DEVICE_LABELS[item.deviceType]}</span>
                    {item.vendor && <span className="rounded bg-slate-800 px-2 py-1">{item.vendor}</span>}
                    {item.location && <span className="rounded bg-slate-800 px-2 py-1">{item.location}</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <span>Gecikme: <b>{item.lastLatencyMs ?? '-'} ms</b></span>
                    <span>Hata: <b>{item.consecutiveFailures}/{item.failureThreshold}</b></span>
                    <span>Servis: <b>{item.services?.length ?? 0}</b></span>
                    <span>Aralık: <b>{item.intervalSeconds} sn</b></span>
                  </div>
                  <p className="mt-2 text-xs opacity-60">Son kontrol: {item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString('tr-TR') : 'Henüz yapılmadı'}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {can('canExcel') && <button disabled={busy} onClick={() => void test(item)} className="ui-button ui-button-compact ui-button-info"><Play className="h-3.5 w-3.5" /> Ping</button>}
                    <button onClick={() => void openDetails(item)} className="ui-button ui-button-compact ui-button-neutral"><BarChart3 className="h-3.5 w-3.5" /> Detay</button>
                    {can('canEdit') && <button onClick={() => edit(item)} className="ui-button ui-button-compact ui-button-neutral"><Edit3 className="h-3.5 w-3.5" /> Düzenle</button>}
                    {can('canDelete') && <button onClick={() => void remove(item)} className="ui-button ui-button-compact ui-button-danger"><Trash2 className="h-3.5 w-3.5" /> Sil</button>}
                  </div>
                </article>
              ))}
            </div>
            {!sorted.length && <p className="py-10 text-center opacity-60">Aramaya uygun cihaz bulunamadı.</p>}
          </section>
        </div>
      )}

      {tab === 'discovery' && (
        <div className="space-y-4">
          <section className="panel-card">
            <h3 className="flex items-center gap-2 font-black"><Search className="h-4 w-4" /> Otomatik Cihaz Keşfi</h3>
            <p className="mt-1 text-sm opacity-70">Belirlediğiniz IPv4 ağı gerçek ICMP Echo Reply ile taranır. Bulunan cihazlar kullanıcı onayı olmadan izlemeye eklenmez.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <span className="mb-1 block text-sm font-semibold">Şube</span>
                <BranchRecordSelector branches={branches} value={discoverBranch} onChange={setDiscoverBranch} />
              </div>
              <Field label="Ağ / CIDR"><input value={cidr} onChange={e => setCidr(e.target.value)} placeholder="10.20.128.0/24" /></Field>
              <Field label="Ping Timeout (ms)"><input type="number" min={300} max={5000} value={discoverTimeout} onChange={e => setDiscoverTimeout(Number(e.target.value))} /></Field>
              <div className="flex items-end"><button disabled={busy || !cidr.trim()} onClick={() => void discover()} className="ui-button ui-button-primary w-full"><Search className="h-4 w-4" /> Ağı Tara</button></div>
            </div>
            <p className="mt-2 text-xs opacity-60">Güvenlik sınırı: tek işlemde /22–/30, en fazla 1024 IP. Ağ taraması yalnız yetkili Network kullanıcıları tarafından yapılabilir.</p>
            {discoveryInfo && <div className="mt-3 rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-3 text-sm">{discoveryInfo}</div>}
          </section>

          {discoveryResults.length > 0 && (
            <section className="panel-card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-black">Keşfedilen Cihazlar</h3>
                <button disabled={busy || selectedDiscovery.size === 0} onClick={() => void addDiscovered()} className="ui-button ui-button-primary"><Plus className="h-4 w-4" /> Seçilenleri İzlemeye Ekle ({selectedDiscovery.size})</button>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full min-w-[850px] text-sm">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr><th className="p-2 text-left">Seç</th><th className="p-2 text-left">IP</th><th className="p-2 text-left">Hostname</th><th className="p-2 text-left">Tahmini Tip</th><th className="p-2 text-left">Latency</th><th className="p-2 text-left">Durum</th></tr>
                  </thead>
                  <tbody>{discoveryResults.map(row => (
                    <tr key={row.ip} className="border-t border-slate-800">
                      <td className="p-2"><input type="checkbox" disabled={row.alreadyMonitored} checked={selectedDiscovery.has(row.ip)} onChange={e => {
                        setSelectedDiscovery(current => {
                          const next = new Set(current);
                          if (e.target.checked) next.add(row.ip); else next.delete(row.ip);
                          return next;
                        });
                      }} /></td>
                      <td className="p-2 font-mono font-bold text-cyan-200">{row.ip}</td>
                      <td className="p-2">{row.hostname || '—'}</td>
                      <td className="p-2">{DEVICE_LABELS[row.deviceType] ?? row.deviceType}</td>
                      <td className="p-2">{row.latencyMs ?? '-'} ms</td>
                      <td className="p-2">{row.alreadyMonitored ? 'Zaten izleniyor' : 'Yeni cihaz'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {tab === 'topology' && (
        <div className="space-y-4">
          <section className="panel-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-black">Ağ Mimarisi Tasarım Alanı</h3>
                <p className="mt-1 text-sm opacity-65">
                  Kullanıcı kendi ağ mimarisini serbestçe çizebilir; cihazları sürükleyebilir, bağlantı kurabilir,
                  lokasyon/not/bulut/internet düğümleri ekleyebilir ve tasarımı şube bazlı kalıcı saklayabilir.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setTopologyMode('map')} className={`ui-button ui-button-compact ${topologyMode === 'map' ? 'ui-button-primary' : 'ui-button-neutral'}`}><Network className="h-3.5 w-3.5"/> Tasarım</button>
                <button onClick={() => setTopologyMode('compact')} className={`ui-button ui-button-compact ${topologyMode === 'compact' ? 'ui-button-primary' : 'ui-button-neutral'}`}><LayoutGrid className="h-3.5 w-3.5"/> Kompakt</button>
                <button onClick={() => setTopologyMode('directory')} className={`ui-button ui-button-compact ${topologyMode === 'directory' ? 'ui-button-primary' : 'ui-button-neutral'}`}><List className="h-3.5 w-3.5"/> Dizin</button>
              </div>
            </div>

            {topologyMode === 'map' && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr_auto]">
                  <div>
                    <label className="mb-1 block text-xs font-bold opacity-60">Çalışma Alanı</label>
                    <select
                      className="form-control"
                      value={topologyWorkspaceId}
                      onChange={event => setTopologyWorkspaceId(event.target.value)}
                    >
                      <option value="">Yeni / Kaydedilmemiş Ağ Mimarisi</option>
                      {topologyWorkspaces.map(workspace => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.branchCode} · {workspace.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold opacity-60">Tasarım Adı</label>
                    <input
                      className="form-control"
                      value={topologyWorkspaceName}
                      onChange={event => {
                        setTopologyWorkspaceName(event.target.value);
                        setTopologyDirty(true);
                      }}
                      placeholder="Örn. Merkez Ana Ağ Mimarisi"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTopologyWorkspaceId('');
                        setTopologyWorkspaceName('Yeni Ağ Mimarisi');
                        setTopologyWorkspaceDescription('');
                        setTopologyBranchCode(defaultRecordBranch(branches));
                        setTopologyLayout({ ...EMPTY_TOPOLOGY_LAYOUT, nodes: [], links: [], settings: { ...EMPTY_TOPOLOGY_LAYOUT.settings } });
                        setTopologyEditing(true);
                        setTopologyDirty(false);
                      }}
                      className="ui-button ui-button-neutral"
                    >
                      <Plus className="h-4 w-4"/> Yeni
                    </button>
                    {can('canEdit') && (
                      <button type="button" onClick={() => setTopologyEditing(value => !value)} className={`ui-button ${topologyEditing ? 'ui-button-primary' : 'ui-button-neutral'}`}>
                        <Edit3 className="h-4 w-4"/> {topologyEditing ? 'Düzenleme Açık' : 'Düzenle'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                  <div>
                    <BranchRecordSelector
                      branches={branches}
                      value={topologyBranchCode}
                      onChange={value => {
                        if (!topologyWorkspaceId) setTopologyBranchCode(value);
                      }}
                      disabled={Boolean(topologyWorkspaceId)}
                    />
                  </div>
                  <input
                    className="form-control"
                    value={topologyWorkspaceDescription}
                    onChange={event => {
                      setTopologyWorkspaceDescription(event.target.value);
                      setTopologyDirty(true);
                    }}
                    placeholder="Bu ağ mimarisinin açıklaması"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {can('canEdit') && (
                    <button type="button" disabled={busy || !topologyWorkspaceName.trim()} onClick={() => void saveTopologyWorkspace()} className="ui-button ui-button-primary">
                      <Save className="h-4 w-4"/> {topologyDirty ? 'Değişiklikleri Kaydet' : 'Kaydedildi'}
                    </button>
                  )}
                  {can('canDelete') && topologyWorkspaceId && (
                    <button type="button" disabled={busy} onClick={() => void deleteTopologyWorkspace()} className="ui-button ui-button-danger">
                      <Trash2 className="h-4 w-4"/> Tasarımı Sil
                    </button>
                  )}
                  <button type="button" onClick={() => updateTopologyZoom(-0.1)} className="ui-button ui-button-neutral"><ZoomOut className="h-4 w-4"/></button>
                  <span className="min-w-[68px] text-center text-xs font-black">{Math.round(topologyLayout.settings.zoom * 100)}%</span>
                  <button type="button" onClick={() => updateTopologyZoom(0.1)} className="ui-button ui-button-neutral"><ZoomIn className="h-4 w-4"/></button>
                  {topologyEditing && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setTopologyLayout(current => ({ ...current, settings: { ...current.settings, grid: !current.settings.grid } }));
                          setTopologyDirty(true);
                        }}
                        className={`ui-button ${topologyLayout.settings.grid ? 'ui-button-info' : 'ui-button-neutral'}`}
                      >
                        <Grid3X3 className="h-4 w-4"/> Izgara
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTopologyLayout(current => ({ ...current, settings: { ...current.settings, snap: !current.settings.snap } }));
                          setTopologyDirty(true);
                        }}
                        className={`ui-button ${topologyLayout.settings.snap ? 'ui-button-info' : 'ui-button-neutral'}`}
                      >
                        Izgaraya Yapıştır
                      </button>
                      <button type="button" onClick={autoLayoutTopology} className="ui-button ui-button-neutral"><LayoutGrid className="h-4 w-4"/> Otomatik Diz</button>
                      <button
                        type="button"
                        onClick={() => {
                          setTopologyConnecting(value => !value);
                          setTopologyLinkStartId('');
                        }}
                        className={`ui-button ${topologyConnecting ? 'ui-button-primary' : 'ui-button-neutral'}`}
                      >
                        <Link2 className="h-4 w-4"/> {topologyConnecting ? 'Bağlantı Modu Açık' : 'Bağlantı Çiz'}
                      </button>
                    </>
                  )}
                </div>

                <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_230px]">
                  <aside className="topology-editor-sidebar">
                    <h4 className="font-black">Öğeler</h4>
                    <p className="mt-1 text-xs opacity-60">İzlenen cihazları veya serbest görsel öğeleri mimariye ekleyin.</p>

                    {topologyEditing && (
                      <>
                        <input className="form-control mt-3" value={topologyNewLabel} onChange={event => setTopologyNewLabel(event.target.value)} placeholder="Öğe adı / açıklama" />
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button onClick={() => addCustomTopologyNode('ROUTER')} className="topology-palette-button"><Router className="h-4 w-4"/> Router</button>
                          <button onClick={() => addCustomTopologyNode('SWITCH')} className="topology-palette-button"><Network className="h-4 w-4"/> Switch</button>
                          <button onClick={() => addCustomTopologyNode('SERVER')} className="topology-palette-button"><Server className="h-4 w-4"/> Sunucu</button>
                          <button onClick={() => addCustomTopologyNode('FIREWALL')} className="topology-palette-button"><Shield className="h-4 w-4"/> Firewall</button>
                          <button onClick={() => addCustomTopologyNode('INTERNET')} className="topology-palette-button"><Globe className="h-4 w-4"/> İnternet</button>
                          <button onClick={() => addCustomTopologyNode('CLOUD')} className="topology-palette-button"><Cloud className="h-4 w-4"/> Bulut</button>
                          <button onClick={() => addCustomTopologyNode('LOCATION')} className="topology-palette-button"><MapPin className="h-4 w-4"/> Lokasyon</button>
                          <button onClick={() => addCustomTopologyNode('NOTE')} className="topology-palette-button"><StickyNote className="h-4 w-4"/> Not</button>
                          <button onClick={() => addCustomTopologyNode('AP')} className="topology-palette-button"><Wifi className="h-4 w-4"/> AP</button>
                          <button onClick={() => addCustomTopologyNode('PRINTER')} className="topology-palette-button"><Printer className="h-4 w-4"/> Yazıcı</button>
                        </div>
                      </>
                    )}

                    <h5 className="mt-4 text-xs font-black uppercase tracking-wide opacity-60">İzlenen Cihazlar</h5>
                    <div className="mt-2 max-h-[460px] space-y-1 overflow-auto pr-1">
                      {items.map(item => {
                        const added = topologyLayout.nodes.some(node => node.monitorId === item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={!topologyEditing || added}
                            onClick={() => addMonitorToTopology(item)}
                            className="topology-device-add"
                          >
                            <DeviceIcon type={item.deviceType}/>
                            <span className="min-w-0 flex-1 text-left"><b className="block truncate">{item.name}</b><small className="block truncate">{item.host}</small></span>
                            <span>{added ? '✓' : '+'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </aside>

                  <div
                    className={`topology-editor-viewport ${topologyLayout.settings.grid ? 'show-grid' : ''}`}
                    onDragOver={event => topologyEditing && event.preventDefault()}
                    onDrop={topologyDrop}
                  >
                    <div
                      className="topology-editor-canvas"
                      style={{
                        width: topologyLayout.settings.width,
                        height: topologyLayout.settings.height,
                        transform: `scale(${topologyLayout.settings.zoom})`,
                      }}
                    >
                      <svg
                        className="topology-editor-links"
                        width={topologyLayout.settings.width}
                        height={topologyLayout.settings.height}
                        aria-hidden="true"
                      >
                        {topologyLayout.links.map(link => {
                          const from = topologyLayout.nodes.find(node => node.id === link.from);
                          const to = topologyLayout.nodes.find(node => node.id === link.to);
                          if (!from || !to) return null;
                          const x1 = from.x + from.width / 2;
                          const y1 = from.y + from.height / 2;
                          const x2 = to.x + to.width / 2;
                          const y2 = to.y + to.height / 2;
                          return (
                            <g key={link.id}>
                              <line
                                x1={x1} y1={y1} x2={x2} y2={y2}
                                className={`topology-editor-link ${link.style === 'DASHED' ? 'dashed' : ''}`}
                              />
                              {link.label && <text x={(x1+x2)/2} y={(y1+y2)/2 - 6} className="topology-editor-link-label">{link.label}</text>}
                            </g>
                          );
                        })}
                      </svg>

                      {topologyLayout.nodes.map(node => {
                        const monitor = node.monitorId ? items.find(item => item.id === node.monitorId) : null;
                        const status = monitor?.status ?? 'UNKNOWN';
                        return (
                          <div
                            key={node.id}
                            draggable={topologyEditing}
                            onDragStart={() => setTopologyDraggingNodeId(node.id)}
                            onDragEnd={() => setTopologyDraggingNodeId('')}
                            onDoubleClick={() => handleTopologyNodeClick(node)}
                            onContextMenu={event => {
                              if (monitor) openRemoteMenu(event, monitor);
                            }}
                            className={[
                              'topology-editor-node',
                              `kind-${node.kind.toLowerCase()}`,
                              monitor ? `status-${status.toLowerCase()}` : '',
                              topologyLinkStartId === node.id ? 'link-source' : '',
                              topologyEditing ? 'editable' : '',
                            ].filter(Boolean).join(' ')}
                            style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
                            title={topologyConnecting ? 'Bağlantı için seç' : monitor ? `${monitor.name} · ${monitor.host}` : node.label}
                          >
                            <button type="button" onClick={() => handleTopologyNodeClick(node)} className="topology-editor-node-main">
                              <TopologyKindIcon kind={node.kind} monitor={monitor}/>
                              <span className="min-w-0 flex-1 text-left">
                                <b className="block truncate">{node.label}</b>
                                <small className="block truncate">{monitor ? monitor.host : node.subtitle}</small>
                                {monitor && <span className={`network-status status-${status.toLowerCase()}`}>{statusText(status)}</span>}
                              </span>
                            </button>
                            {topologyEditing && (
                              <button type="button" onClick={() => removeTopologyNode(node.id)} className="topology-node-remove" title="Öğeyi tasarımdan kaldır">
                                <X className="h-3 w-3"/>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <aside className="topology-editor-sidebar">
                    <h4 className="font-black">Tasarım Bilgisi</h4>
                    <dl className="mt-2 space-y-2 text-xs">
                      <div><dt className="opacity-55">Düğüm</dt><dd className="font-black">{topologyLayout.nodes.length}</dd></div>
                      <div><dt className="opacity-55">Bağlantı</dt><dd className="font-black">{topologyLayout.links.length}</dd></div>
                      <div><dt className="opacity-55">Şube</dt><dd className="font-black">{topologyBranchCode || '—'}</dd></div>
                      <div><dt className="opacity-55">Durum</dt><dd className="font-black">{topologyDirty ? 'Kaydedilmemiş değişiklik var' : 'Kaydedildi'}</dd></div>
                    </dl>

                    {topologyConnecting && (
                      <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs">
                        {topologyLinkStartId ? 'Şimdi bağlantının ikinci öğesini seçin.' : 'Bağlantının başlayacağı öğeyi seçin.'}
                      </div>
                    )}

                    <h5 className="mt-4 text-xs font-black uppercase tracking-wide opacity-60">Bağlantılar</h5>
                    <div className="mt-2 max-h-[360px] space-y-2 overflow-auto">
                      {topologyLayout.links.map(link => {
                        const from = topologyLayout.nodes.find(node => node.id === link.from);
                        const to = topologyLayout.nodes.find(node => node.id === link.to);
                        return (
                          <div key={link.id} className="topology-link-row">
                            <div className="min-w-0 flex-1">
                              <b className="block truncate">{from?.label ?? '?'} → {to?.label ?? '?'}</b>
                              {topologyEditing ? (
                                <div className="mt-1 grid grid-cols-[1fr_90px] gap-1">
                                  <input
                                    className="form-control !py-1 !text-[10px]"
                                    value={link.label}
                                    onChange={event => {
                                      setTopologyLayout(current => ({
                                        ...current,
                                        links: current.links.map(item => item.id === link.id ? { ...item, label: event.target.value } : item),
                                      }));
                                      setTopologyDirty(true);
                                    }}
                                    placeholder="VLAN / Port / Hat"
                                  />
                                  <select
                                    className="form-control !py-1 !text-[10px]"
                                    value={link.style}
                                    onChange={event => {
                                      setTopologyLayout(current => ({
                                        ...current,
                                        links: current.links.map(item => item.id === link.id ? { ...item, style: event.target.value as 'SOLID' | 'DASHED' } : item),
                                      }));
                                      setTopologyDirty(true);
                                    }}
                                  >
                                    <option value="SOLID">Düz</option>
                                    <option value="DASHED">Kesik</option>
                                  </select>
                                </div>
                              ) : (
                                <span className="block text-[10px] opacity-55">{link.label || 'Bağlantı'}</span>
                              )}
                            </div>
                            {topologyEditing && <button type="button" onClick={() => removeTopologyLink(link.id)} className="ui-button ui-button-icon ui-button-danger"><Unlink className="h-3 w-3"/></button>}
                          </div>
                        );
                      })}
                      {!topologyLayout.links.length && <p className="py-3 text-center text-xs opacity-55">Henüz bağlantı çizilmedi.</p>}
                    </div>
                  </aside>
                </div>
              </div>
            )}

            {topologyMode === 'compact' && (
              <div className="network-compact-grid mt-4">
                {sorted.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openDetails(item)}
                    onContextMenu={event => openRemoteMenu(event, item)}
                    className={`network-compact-node status-${item.status.toLowerCase()}`}
                    title="Sağ tık: Uzak Bağlan"
                  >
                    <span className="flex min-w-0 items-center gap-2"><DeviceIcon type={item.deviceType}/><b className="truncate">{item.name}</b></span>
                    <span className="font-mono text-[11px] opacity-70">{item.host}</span>
                    <span className="text-[10px] font-black">{statusText(item.status)} · {item.lastLatencyMs ?? '-'} ms</span>
                  </button>
                ))}
              </div>
            )}

            {topologyMode === 'directory' && (
              <div className="network-directory mt-4">
                {sorted.map(item => (
                  <div
                    key={item.id}
                    onContextMenu={event => openRemoteMenu(event, item)}
                    className={`network-directory-row status-${item.status.toLowerCase()}`}
                    title="Sağ tık: Uzak Bağlan"
                  >
                    <button type="button" onClick={() => void openDetails(item)} className="network-directory-main">
                      <DeviceIcon type={item.deviceType}/>
                      <span className="min-w-0 flex-1 text-left">
                        <b className="block truncate">{item.name}</b>
                        <span className="block truncate font-mono text-[11px] opacity-65">{item.host} · Şube {item.branchCode} · {DEVICE_LABELS[item.deviceType]}</span>
                      </span>
                      <span className={`network-status status-${item.status.toLowerCase()}`}>{statusText(item.status)}</span>
                      <span className="w-20 text-right text-xs font-bold">{item.lastLatencyMs ?? '-'} ms</span>
                    </button>
                    <button type="button" onClick={event => openRemoteMenu(event, item)} className="ui-button ui-button-compact ui-button-neutral">
                      <Monitor className="h-3.5 w-3.5"/> Uzak Bağlan
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {selected && (
        <section className="panel-card">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-black"><DeviceIcon type={selected.deviceType} /> {selected.name}</h3>
              <p className="font-mono text-sm opacity-70">{selected.host} · Şube {selected.branchCode}</p>
            </div>
            <button onClick={() => { setSelectedId(''); setEvents([]); setMetrics(null); setServices([]); setSnmpData(null); }} className="ui-button ui-button-icon ui-button-neutral"><X className="h-4 w-4" /></button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MiniMetric label="Uptime" value={`${metrics?.uptimePercent ?? 0}%`} />
            <MiniMetric label="Downtime" value={`${metrics?.downtimeMinutes ?? 0} dk`} />
            <MiniMetric label="Paket Kaybı" value={`${metrics?.packetLossPercent ?? 0}%`} />
            <MiniMetric label="Ort. Latency" value={`${metrics?.avgLatencyMs ?? 0} ms`} />
            <MiniMetric label="Max Latency" value={`${metrics?.maxLatencyMs ?? 0} ms`} />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-black">Performans Grafiği</h4>
            <select value={metricsHours} onChange={e => setMetricsHours(Number(e.target.value))} className="form-control max-w-[180px]">
              <option value={1}>Son 1 Saat</option>
              <option value={24}>Son 24 Saat</option>
              <option value={168}>Son 7 Gün</option>
              <option value={720}>Son 30 Gün</option>
            </select>
          </div>
          <LatencyChart samples={metrics?.samples ?? []} />

          {selected.snmpEnabled && (
            <section className="mt-4 rounded-2xl border border-cyan-500/20 bg-slate-950/35 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-black">SNMP Performans / Cihaz Bilgileri</h4>
                  <p className="text-xs opacity-60">SNMP {selected.snmpVersion} · UDP/{selected.snmpPort} · {snmpData?.latest?.sysName || selected.name}</p>
                </div>
                {can('canExcel') && <button disabled={snmpBusy} onClick={() => void testSnmp(selected)} className="ui-button ui-button-info">
                  <Activity className={`h-4 w-4 ${snmpBusy ? 'animate-spin' : ''}`} /> SNMP Sına / Yenile
                </button>}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <MiniMetric label="CPU" value={snmpData?.latest?.cpuPercent == null ? 'Desteklenmiyor' : `${snmpData.latest.cpuPercent}%`} />
                <MiniMetric label="RAM" value={snmpData?.latest?.memoryPercent == null ? 'Desteklenmiyor' : `${snmpData.latest.memoryPercent}%`} />
                <MiniMetric label="Disk" value={snmpData?.latest?.diskPercent == null ? 'Desteklenmiyor' : `${snmpData.latest.diskPercent}%`} />
              </div>

              {snmpData?.latest && <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/45 p-3 text-xs">
                <div><b>sysName:</b> {snmpData.latest.sysName || '—'}</div>
                <div className="mt-1"><b>sysDescr:</b> {snmpData.latest.sysDescr || '—'}</div>
                <div className="mt-1"><b>Lokasyon:</b> {snmpData.latest.sysLocation || '—'} · <b>İletişim:</b> {snmpData.latest.sysContact || '—'}</div>
              </div>}

              <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-700">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr><th className="p-2 text-left">Interface</th><th className="p-2 text-left">Durum</th><th className="p-2 text-left">Hız</th><th className="p-2 text-left">RX</th><th className="p-2 text-left">TX</th></tr>
                  </thead>
                  <tbody>{(snmpData?.interfaces ?? []).map(row => (
                    <tr key={row.interfaceIndex} className="border-t border-slate-800">
                      <td className="p-2"><b>{row.interfaceName}</b><span className="ml-2 opacity-50">#{row.interfaceIndex}</span></td>
                      <td className="p-2">{row.operStatus === 1 ? 'UP' : row.operStatus === 2 ? 'DOWN' : '—'}</td>
                      <td className="p-2">{row.speedBps ? formatBps(Number(row.speedBps)) : '—'}</td>
                      <td className="p-2 font-mono">{formatBps(row.inBps)}</td>
                      <td className="p-2 font-mono">{formatBps(row.outBps)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {!snmpData?.interfaces?.length && <p className="p-5 text-center text-sm opacity-60">Henüz SNMP interface verisi yok. “SNMP Sına / Yenile” ile ilk sorguyu çalıştırın.</p>}
              </div>
            </section>
          )}

          <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-black">Port / Servis İzleme</h4>
                <span className="text-xs opacity-60">{services.length} servis</span>
              </div>
              <div className="space-y-2">
                {services.map(service => (
                  <div key={service.id} className="rounded-xl border border-slate-700 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <strong>{service.name}</strong>
                          <span className={`network-status status-${service.status.toLowerCase()}`}>{statusText(service.status)}</span>
                        </div>
                        <p className="text-xs opacity-65">{service.protocol} · Port {service.port}{service.path ? ` · ${service.path}` : ''} · {service.lastLatencyMs ?? '-'} ms</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {can('canExcel') && <button onClick={() => void testService(service)} className="ui-button ui-button-compact ui-button-info"><Play className="h-3.5 w-3.5" /> Test</button>}
                        {can('canEdit') && <button onClick={() => editService(service)} className="ui-button ui-button-compact ui-button-neutral"><Edit3 className="h-3.5 w-3.5" /></button>}
                        {can('canEdit') && <button onClick={() => void deleteService(service)} className="ui-button ui-button-compact ui-button-danger"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    </div>
                  </div>
                ))}
                {!services.length && <p className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm opacity-60">Bu cihaz için servis tanımı yok.</p>}
              </div>

              {can('canEdit') && (
                <div className="mt-3 rounded-xl border border-slate-700 p-3">
                  <h5 className="font-bold">{serviceEditingId ? 'Servisi Düzenle' : 'Yeni Servis Ekle'}</h5>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Servis Adı"><input value={serviceForm.name} onChange={e => setServiceForm(v => ({ ...v, name: e.target.value }))} placeholder="Web Yönetim" /></Field>
                    <Field label="Protokol"><select value={serviceForm.protocol} onChange={e => {
                      const protocol = e.target.value as NetworkService['protocol'];
                      setServiceForm(v => ({ ...v, protocol, port: SERVICE_DEFAULT_PORTS[protocol], path: protocol === 'HTTP' || protocol === 'HTTPS' ? '/' : '' }));
                    }}>
                      {Object.keys(SERVICE_DEFAULT_PORTS).map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}
                    </select></Field>
                    <Field label="Port"><input type="number" min={1} max={65535} value={serviceForm.port} onChange={e => setServiceForm(v => ({ ...v, port: Number(e.target.value) }))} /></Field>
                    {(serviceForm.protocol === 'HTTP' || serviceForm.protocol === 'HTTPS') && <Field label="Path"><input value={serviceForm.path} onChange={e => setServiceForm(v => ({ ...v, path: e.target.value }))} placeholder="/" /></Field>}
                    {(serviceForm.protocol === 'HTTP' || serviceForm.protocol === 'HTTPS') && <Field label="Beklenen HTTP Kodu"><input type="number" value={serviceForm.expectedStatus ?? ''} onChange={e => setServiceForm(v => ({ ...v, expectedStatus: e.target.value ? Number(e.target.value) : null }))} placeholder="Boş = 2xx-4xx" /></Field>}
                    <Field label="Timeout (ms)"><input type="number" value={serviceForm.timeoutMs} onChange={e => setServiceForm(v => ({ ...v, timeoutMs: Number(e.target.value) }))} /></Field>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={serviceForm.active} onChange={e => setServiceForm(v => ({ ...v, active: e.target.checked }))} /> Aktif</label>
                    <button disabled={busy} onClick={() => void saveService()} className="ui-button ui-button-primary"><Save className="h-4 w-4" /> Kaydet</button>
                    {serviceEditingId && <button onClick={() => { setServiceEditingId(null); setServiceForm(EMPTY_SERVICE); }} className="ui-button ui-button-neutral">Vazgeç</button>}
                  </div>
                </div>
              )}
            </div>

            <div>
              <h4 className="mb-2 font-black">Ping / Alarm Geçmişi</h4>
              <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900"><tr><th className="p-2 text-left">Zaman</th><th className="p-2 text-left">Durum</th><th className="p-2 text-left">Latency</th><th className="p-2 text-left">Açıklama</th></tr></thead>
                  <tbody>{events.map(event => (
                    <tr key={event.id} className="border-t border-slate-800">
                      <td className="p-2 text-xs">{new Date(event.createdAt).toLocaleString('tr-TR')}</td>
                      <td className="p-2 font-bold">{event.success ? 'Başarılı' : 'Başarısız'}</td>
                      <td className="p-2">{event.latencyMs ?? '-'} ms</td>
                      <td className="p-2 text-xs">{event.message}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {!events.length && <p className="p-6 text-center opacity-60">Henüz geçmiş kaydı yok.</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      {contextMenu && (
        <div
          className="network-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={event => event.stopPropagation()}
        >
          <div className="network-context-title">
            <b>{contextMenu.item.name}</b>
            <span>{contextMenu.item.host}</span>
          </div>
          {(contextMenu.item.operatingSystem === 'WINDOWS' || contextMenu.item.operatingSystem === 'UNKNOWN' || contextMenu.item.operatingSystem === 'OTHER') && (
            <button type="button" onClick={() => openRdp(contextMenu.item)}><Monitor className="h-4 w-4"/> RDP ile Bağlan</button>
          )}
          {(contextMenu.item.operatingSystem === 'LINUX' || contextMenu.item.operatingSystem === 'NETWORK' || contextMenu.item.operatingSystem === 'UNKNOWN' || contextMenu.item.operatingSystem === 'OTHER') && (
            <>
              <button type="button" onClick={() => openSsh(contextMenu.item)}><Terminal className="h-4 w-4"/> SSH / PuTTY Bağlantısını Aç</button>
              <button type="button" onClick={() => void copyPuttyCommand(contextMenu.item)}><Copy className="h-4 w-4"/> PuTTY Komutunu Kopyala</button>
            </>
          )}
          <button type="button" onClick={() => { void openDetails(contextMenu.item); setContextMenu(null); }}><BarChart3 className="h-4 w-4"/> Cihaz Detayını Aç</button>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`ui-button ${active ? 'ui-button-primary' : 'ui-button-neutral'}`}>{children}</button>;
}

function StatCard({ title, value, subtitle, tone = 'neutral' }: { title: string; value: string | number; subtitle: string; tone?: 'neutral' | 'online' | 'offline' | 'warning' }) {
  const toneClass = tone === 'online' ? 'border-emerald-500/30' : tone === 'offline' ? 'border-red-500/30' : tone === 'warning' ? 'border-amber-500/30' : 'border-slate-700';
  return <div className={`rounded-2xl border ${toneClass} bg-slate-900/55 p-4`}>
    <p className="text-xs font-bold uppercase tracking-wide opacity-60">{title}</p>
    <p className="mt-1 text-2xl font-black">{value}</p>
    <p className="mt-1 text-xs opacity-60">{subtitle}</p>
  </div>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
    <p className="text-[11px] font-bold uppercase opacity-55">{label}</p>
    <p className="mt-1 text-lg font-black">{value}</p>
  </div>;
}

function LatencyChart({ samples }: { samples: Array<{ at: number; success: boolean; latencyMs: number | null }> }) {
  if (!samples.length) return <div className="mt-2 flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm opacity-60">Grafik için henüz yeterli ping verisi yok.</div>;

  const values = samples.map(sample => sample.latencyMs ?? 0);
  const max = Math.max(10, ...values);
  const points = samples.map((sample, index) => {
    const x = samples.length === 1 ? 50 : (index / (samples.length - 1)) * 100;
    const y = 100 - ((sample.latencyMs ?? 0) / max) * 88 - 6;
    return `${x},${Math.max(6, Math.min(94, y))}`;
  }).join(' ');

  return <div className="mt-2 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/50 p-3">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-36 w-full">
      <line x1="0" y1="94" x2="100" y2="94" stroke="currentColor" opacity=".2" vectorEffect="non-scaling-stroke" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {samples.map((sample, index) => {
        if (sample.success) return null;
        const x = samples.length === 1 ? 50 : (index / (samples.length - 1)) * 100;
        return <circle key={`${sample.at}-${index}`} cx={x} cy="94" r="1.4" fill="currentColor" opacity=".75" />;
      })}
    </svg>
    <div className="mt-1 flex justify-between text-[10px] opacity-55">
      <span>{new Date(samples[0].at).toLocaleString('tr-TR')}</span>
      <span>Latency · başarısız pingler taban çizgisinde işaretlenir</span>
      <span>{new Date(samples[samples.length - 1].at).toLocaleString('tr-TR')}</span>
    </div>
  </div>;
}

function DeviceCard({
  item, canTest, busy, onTest, onDetails, onEdit, canEdit,
}: {
  item: NetworkMonitor;
  canTest: boolean;
  busy: boolean;
  onTest: (item: NetworkMonitor) => Promise<void>;
  onDetails: (item: NetworkMonitor) => Promise<void>;
  onEdit: (item: NetworkMonitor) => void;
  canEdit: boolean;
}) {
  const statusText = item.status === 'ONLINE' ? 'ERİŞİM VAR' : item.status === 'OFFLINE' ? 'ERİŞİM YOK' : 'BEKLENİYOR';
  return <article className={`network-monitor-card status-${item.status.toLowerCase()}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><DeviceIcon type={item.deviceType} /><h4 className="truncate font-black">{item.name}</h4></div>
        <p className="font-mono text-sm">{item.host}</p>
      </div>
      <span className={`network-status status-${item.status.toLowerCase()}`}><CircleDot className="h-3.5 w-3.5" /> {statusText}</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
      <span>Latency: <b>{item.lastLatencyMs ?? '-'} ms</b></span>
      <span>Servis: <b>{item.services?.length ?? 0}</b></span>
      <span>Şube: <b>{item.branchCode}</b></span>
      <span>Tip: <b>{DEVICE_LABELS[item.deviceType]}</b></span>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      {canTest && <button disabled={busy} onClick={() => void onTest(item)} className="ui-button ui-button-compact ui-button-info"><Play className="h-3.5 w-3.5" /> Ping</button>}
      <button onClick={() => void onDetails(item)} className="ui-button ui-button-compact ui-button-neutral"><BarChart3 className="h-3.5 w-3.5" /> Detay</button>
      {canEdit && <button onClick={() => onEdit(item)} className="ui-button ui-button-compact ui-button-neutral"><Edit3 className="h-3.5 w-3.5" /> Düzenle</button>}
    </div>
  </article>;
}

function TopologyKindIcon({ kind, monitor }: { kind: NetworkTopologyNodeKind; monitor?: NetworkMonitor | null }) {
  const cls = 'h-5 w-5 shrink-0';
  if (monitor) return <DeviceIcon type={monitor.deviceType} />;
  if (kind === 'ROUTER') return <Router className={cls}/>;
  if (kind === 'SWITCH') return <Network className={cls}/>;
  if (kind === 'SERVER') return <Server className={cls}/>;
  if (kind === 'FIREWALL') return <Shield className={cls}/>;
  if (kind === 'INTERNET') return <Globe className={cls}/>;
  if (kind === 'CLOUD') return <Cloud className={cls}/>;
  if (kind === 'LOCATION') return <MapPin className={cls}/>;
  if (kind === 'NOTE') return <StickyNote className={cls}/>;
  if (kind === 'AP') return <Wifi className={cls}/>;
  if (kind === 'PRINTER') return <Printer className={cls}/>;
  return <Monitor className={cls}/>;
}

function DeviceIcon({ type }: { type: NetworkMonitor['deviceType'] }) {
  const cls = 'h-4 w-4';
  if (type === 'ROUTER') return <Router className={cls} />;
  if (type === 'SERVER') return <Server className={cls} />;
  if (type === 'PRINTER') return <Printer className={cls} />;
  if (type === 'ACCESS_POINT') return <Wifi className={cls} />;
  if (type === 'FIREWALL') return <Shield className={cls} />;
  if (type === 'SWITCH') return <Network className={cls} />;
  if (type === 'COMPUTER') return <Globe className={cls} />;
  return <Activity className={cls} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mt-2 block text-sm"><span className="mb-1 block font-semibold">{label}</span>{children}</label>;
}
