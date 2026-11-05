import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import esES from "antd/locale/es_ES";
import {
  ApiOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  CodeOutlined,
  CopyOutlined,
  DownloadOutlined,
  FilterOutlined,
  LockOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import JsonView from "@uiw/react-json-view";
import dayjs from "dayjs";
import "dayjs/locale/es";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "antd/dist/reset.css";
import "./style.css";

dayjs.locale("es");
type EventRow = {
  request_id: string;
  event_code: string;
  received_at: string;
  preview: string;
  size_bytes: number;
};
type Detail = EventRow & { payload: Record<string, unknown> | unknown[] };
type Page = { items: EventRow[]; total: number };
type Summary = {
  total: number;
  today: number;
  last_received_at: string | null;
  event_codes: { code: string; count: number }[];
};
const emptySummary: Summary = {
  total: 0,
  today: 0,
  last_received_at: null,
  event_codes: [],
};
const number = new Intl.NumberFormat("es-PE");
const date = (
  value: string | null,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  },
) =>
  value
    ? new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        ...options,
      }).format(new Date(value))
    : "Sin eventos";
const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof body.detail === "string"
        ? body.detail
        : "No se pudo completar la solicitud. Intenta de nuevo.",
    );
  return body;
}
const Logo = () => (
  <span className="brand-mark" aria-hidden="true">
    <ApiOutlined />
  </span>
);

function EventsApp() {
  const { message } = AntApp.useApp();
  const [user, setUser] = useState<string | null>(null),
    [checking, setChecking] = useState(true),
    [loginBusy, setLoginBusy] = useState(false),
    [loginError, setLoginError] = useState("");
  const [data, setData] = useState<Page>({ items: [], total: 0 }),
    [summary, setSummary] = useState<Summary>(emptySummary);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [code, setCode] = useState<string | undefined>();
  const [period, setPeriod] = useState("all"),
    [range, setRange] = useState<[string, string] | null>(null),
    [order, setOrder] = useState("desc");
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25),
    [auto, setAuto] = useState(true),
    [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [updated, setUpdated] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState("");
  const [jsonMode, setJsonMode] = useState("tree");
  const sequence = useRef(0);
  useEffect(() => {
    api<{ username: string }>("/session")
      .then((r) => setUser(r.username))
      .catch((e) => {
        if (e.status !== 401) setLoginError(e.message);
      })
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!user || !auto) return;
    const timer = setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1);
    }, 10000);
    return () => clearInterval(timer);
  }, [user, auto]);
  const expire = useCallback(() => {
    setUser(null);
    setData({ items: [], total: 0 });
    setSummary(emptySummary);
    setSelected(null);
    setDetail(null);
    setLoginError("Tu sesión terminó. Vuelve a ingresar.");
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController(),
      id = ++sequence.current;
    const params = new URLSearchParams({
      q: query,
      event_code: code || "",
      page: String(page),
      page_size: String(pageSize),
      order,
    });
    if (period === "custom" && range) {
      params.set("since", range[0]);
      params.set("until", range[1]);
    } else if (period !== "all" && period !== "custom")
      params.set(
        "since",
        new Date(Date.now() - Number(period) * 86400000).toISOString(),
      );
    setBusy(true);
    Promise.all([
      api<Page>(`/events?${params}`, { signal: controller.signal }),
      api<Summary>("/events-summary", { signal: controller.signal }),
    ])
      .then(([rows, stats]) => {
        if (sequence.current !== id) return;
        if (page > 1 && rows.items.length === 0 && rows.total > 0) {
          setPage(Math.ceil(rows.total / pageSize));
          return;
        }
        setData(rows);
        setSummary(stats);
        setError("");
        setUpdated(new Date().toISOString());
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        if (e.status === 401) expire();
        else setError(e.message);
      })
      .finally(() => {
        if (sequence.current === id) setBusy(false);
      });
    return () => controller.abort();
  }, [user, query, code, period, range, page, pageSize, order, tick, expire]);
  useEffect(() => {
    setDetail(null);
    setDetailError("");
    if (!selected || !user) return;
    const controller = new AbortController();
    api<Detail>(`/events/${encodeURIComponent(selected)}`, {
      signal: controller.signal,
    })
      .then(setDetail)
      .catch((e) => {
        if (e.name === "AbortError") return;
        if (e.status === 401) expire();
        else setDetailError(e.message);
      });
    return () => controller.abort();
  }, [selected, user, expire]);
  async function login(values: { username: string; password: string }) {
    setLoginBusy(true);
    setLoginError("");
    try {
      const r = await api<{ username: string }>("/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setUser(r.username);
      setTick((t) => t + 1);
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/logout", { method: "POST" });
      setUser(null);
      setData({ items: [], total: 0 });
      setSummary(emptySummary);
      setDetail(null);
      setSelected(null);
    } catch {
      message.error("No se pudo cerrar la sesión. Intenta de nuevo.");
    }
  }
  function download() {
    if (!detail) return;
    const blob = new Blob([JSON.stringify(detail, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `zlink-${detail.request_id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const columns: TableColumnsType<EventRow> = [
    {
      title: "Evento",
      dataIndex: "event_code",
      width: 260,
      render: (value: string, row) => (
        <div className="event-cell">
          <span
            className={`event-icon ${value === "integration.test" ? "test" : ""}`}
          >
            <ThunderboltOutlined />
          </span>
          <div>
            <button
              className="event-link"
              onClick={() => setSelected(row.request_id)}
            >
              {value}
            </button>
            <div className="cell-muted">
              {value === "integration.test"
                ? "Prueba de integración"
                : "ZKBio Zlink"}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Identificador",
      dataIndex: "request_id",
      width: 270,
      render: (value: string) => (
        <Tooltip title={value}>
          <span className="request-id">{value}</span>
        </Tooltip>
      ),
    },
    {
      title: "Recibido · Lima",
      dataIndex: "received_at",
      width: 205,
      render: (value: string) => (
        <span className="timestamp">
          {date(value, {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      ),
    },
    {
      title: "Estado",
      width: 135,
      render: () => (
        <Tag icon={<CheckCircleOutlined />} color="success" bordered={false}>
          Guardado
        </Tag>
      ),
    },
    {
      title: "Tamaño",
      dataIndex: "size_bytes",
      width: 90,
      align: "right",
      render: (value: number) => (
        <span className="cell-muted">{size(value)}</span>
      ),
    },
    {
      title: "",
      width: 60,
      render: (_, row) => (
        <Tooltip title="Ver detalle">
          <Button
            type="text"
            icon={<ArrowRightOutlined />}
            aria-label={`Ver evento ${row.request_id}`}
            onClick={() => setSelected(row.request_id)}
          />
        </Tooltip>
      ),
    },
  ];
  if (checking)
    return (
      <div className="initial-loading">
        <Logo />
        <span>Abriendo ZLINK…</span>
      </div>
    );
  if (!user)
    return (
      <main className="login-page">
        <section className="login-story">
          <div className="brand">
            <Logo />
            <span>
              ZLINK<span className="brand-sub">Event console</span>
            </span>
          </div>
          <div className="login-headline">
            <span className="small-label">
              Tu integración, en un solo lugar
            </span>
            <h1>
              Cada evento.
              <br />
              Todo el contexto.
            </h1>
            <p>
              Explora lo que llega de ZKBio Zlink, encuentra el registro que
              necesitas y revisa cada detalle.
            </p>
            <div className="login-trace" aria-hidden="true">
              <div>
                <span className="trace-dot" />
                <span>Evento recibido</span>
                <CheckCircleOutlined />
              </div>
              <div>
                <span className="trace-line" />
              </div>
              <div>
                <span className="trace-dot" />
                <span>Contenido verificado</span>
                <CheckCircleOutlined />
              </div>
              <div>
                <span className="trace-line" />
              </div>
              <div>
                <span className="trace-dot" />
                <span>Listo para explorar</span>
                <ArrowRightOutlined />
              </div>
            </div>
          </div>
          <span className="login-bottom">TROK / Integraciones conectadas</span>
        </section>
        <section className="login-form">
          <div className="form-inner">
            <span className="login-lock">
              <LockOutlined />
            </span>
            <h2>Bienvenido a tu consola</h2>
            <p>Ingresa para consultar los eventos de tu integración.</p>
            {loginError && (
              <Alert
                type="error"
                showIcon
                title={loginError}
                className="form-alert"
              />
            )}
            <Form
              layout="vertical"
              onFinish={login}
              initialValues={{ username: "trok" }}
              requiredMark={false}
            >
              <Form.Item
                label="Usuario"
                name="username"
                rules={[{ required: true, message: "Ingresa tu usuario" }]}
              >
                <Input autoComplete="username" size="large" />
              </Form.Item>
              <Form.Item
                label="Contraseña"
                name="password"
                rules={[{ required: true, message: "Ingresa tu contraseña" }]}
              >
                <Input.Password autoComplete="current-password" size="large" />
              </Form.Item>
              <Button
                htmlType="submit"
                type="primary"
                size="large"
                block
                loading={loginBusy}
              >
                Ingresar <ArrowRightOutlined />
              </Button>
            </Form>
            <div className="private-note">
              <LockOutlined /> Acceso privado a tus eventos
            </div>
          </div>
        </section>
      </main>
    );
  const activeFilters = !!query || !!code || period !== "all";
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span>
            ZLINK<span className="brand-sub">Event console</span>
          </span>
        </div>
        <div className="workspace-label">Espacio de trabajo</div>
        <nav>
          <a href="/events" className="nav-active">
            <ThunderboltOutlined /> Eventos{" "}
            <span>{number.format(summary.total)}</span>
          </a>
        </nav>
        <div className="source-panel">
          <CloudServerOutlined />
          <span>
            Origen de eventos<strong>ZKBio Zlink</strong>
          </span>
        </div>
        <div className="sidebar-bottom">
          <div className="avatar">T</div>
          <div>
            <strong>TROK</strong>
            <span>Consola de integración</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            <span>Integraciones</span>
            <span>/</span>
            <strong>Eventos</strong>
          </span>
          <div className="account">
            <LockOutlined />
            <span>{user}</span>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={logout}
              aria-label="Cerrar sesión"
            />
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="page-kicker">
                <span className="connector-line" /> ZKBio Zlink
              </div>
              <h1>Explorador de eventos</h1>
              <p>Una vista clara de todo lo que recibe tu integración.</p>
            </div>
            <Button
              icon={<ReloadOutlined spin={busy} />}
              onClick={() => setTick((t) => t + 1)}
              disabled={busy}
            >
              Actualizar
            </Button>
          </div>
          <section
            className="overview"
            aria-label="Resumen de todos los eventos"
          >
            <div>
              <span>Total de eventos</span>
              <strong>{number.format(summary.total)}</strong>
              <small>En tu bandeja de recepción</small>
            </div>
            <div>
              <span>Recibidos hoy</span>
              <strong>{number.format(summary.today)}</strong>
              <small>Desde las 00:00 en Lima</small>
            </div>
            <div>
              <span>Tipos de evento</span>
              <strong>{number.format(summary.event_codes.length)}</strong>
              <small>Códigos únicos recibidos</small>
            </div>
            <div className="last-event">
              <span>Último evento</span>
              <strong>
                {summary.last_received_at
                  ? date(summary.last_received_at, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "—"}
              </strong>
              <small>
                {summary.last_received_at
                  ? date(summary.last_received_at, {
                      day: "2-digit",
                      month: "long",
                    })
                  : "Esperando el primer evento"}
              </small>
            </div>
          </section>
          {error && (
            <Alert
              className="data-error"
              type="error"
              showIcon
              title="No se pudieron actualizar los eventos"
              description={error}
              action={
                <Button onClick={() => setTick((t) => t + 1)}>
                  Reintentar
                </Button>
              }
            />
          )}
          <section className="event-panel">
            <div className="panel-title">
              <div>
                <h2>
                  Bandeja de eventos <span>{number.format(data.total)}</span>
                </h2>
                <p>Eventos verificados y almacenados, sin duplicados.</p>
              </div>
              <div className="auto-control">
                <Switch
                  checked={auto}
                  onChange={setAuto}
                  size="small"
                  aria-label="Actualización automática"
                />
                <span>Actualizar cada 10 s</span>
              </div>
            </div>
            <div className="filters">
              <Input
                className="search"
                prefix={<SearchOutlined />}
                placeholder="Buscar por ID, evento o contenido…"
                aria-label="Buscar eventos"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                allowClear
              />
              <Select
                aria-label="Tipo de evento"
                placeholder="Todos los eventos"
                value={code}
                allowClear
                onChange={(v) => {
                  setCode(v);
                  setPage(1);
                }}
                options={summary.event_codes.map((e) => ({
                  value: e.code,
                  label: e.code,
                }))}
              />
              <Select
                aria-label="Período"
                value={period}
                onChange={(v) => {
                  setPeriod(v);
                  setPage(1);
                }}
                options={[
                  { value: "all", label: "Todo el historial" },
                  { value: "1", label: "Últimas 24 horas" },
                  { value: "7", label: "Últimos 7 días" },
                  { value: "30", label: "Últimos 30 días" },
                  { value: "custom", label: "Elegir fechas" },
                ]}
              />
              <Select
                aria-label="Orden de los eventos"
                value={order}
                onChange={(v) => {
                  setOrder(v);
                  setPage(1);
                }}
                options={[
                  { value: "desc", label: "Más recientes" },
                  { value: "asc", label: "Más antiguos" },
                ]}
              />
            </div>
            {period === "custom" && (
              <div className="custom-range">
                <label>
                  Fechas de recepción{" "}
                  <DatePicker.RangePicker
                    aria-label="Rango de fechas"
                    format="DD/MM/YYYY"
                    onChange={(dates) => {
                      setRange(
                        dates?.[0] && dates?.[1]
                          ? [
                              dates[0].startOf("day").toISOString(),
                              dates[1].endOf("day").toISOString(),
                            ]
                          : null,
                      );
                      setPage(1);
                    }}
                  />
                </label>
                <span>Según la zona horaria de tu navegador.</span>
              </div>
            )}
            {activeFilters && (
              <div className="filter-status">
                <FilterOutlined />
                <span>{number.format(data.total)} resultados</span>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setSearch("");
                    setQuery("");
                    setCode(undefined);
                    setPeriod("all");
                    setRange(null);
                    setPage(1);
                  }}
                >
                  Limpiar filtros
                </Button>
              </div>
            )}
            <Table<EventRow>
              rowKey="request_id"
              columns={columns}
              dataSource={data.items}
              loading={busy}
              scroll={{ x: 1020 }}
              pagination={{
                current: page,
                pageSize,
                total: data.total,
                showSizeChanger: true,
                pageSizeOptions: [10, 25, 50, 100],
                showTotal: (total) => `${number.format(total)} eventos`,
                onChange: (p, s) => {
                  setPage(s !== pageSize ? 1 : p);
                  setPageSize(s);
                },
              }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <>
                        <strong>
                          {activeFilters
                            ? "No hay coincidencias"
                            : "Tu bandeja está lista"}
                        </strong>
                        <p>
                          {activeFilters
                            ? "Prueba con otros filtros o busca otro término."
                            : "Los eventos aparecerán aquí cuando Zlink los envíe. Revisa las suscripciones en tu aplicación."}
                        </p>
                      </>
                    }
                  />
                ),
              }}
            />
            <div className="panel-footer">
              <span>
                <Badge
                  status={error ? "error" : auto ? "processing" : "default"}
                />
                {error
                  ? "Actualización interrumpida"
                  : auto
                    ? "Actualización automática activada"
                    : "Actualización automática pausada"}
              </span>
              <span aria-live="polite">
                {updated
                  ? `Última consulta: ${date(updated, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "Consultando eventos…"}
              </span>
            </div>
          </section>
          <footer className="page-footer">
            <span>
              <CheckCircleOutlined /> Los eventos se guardan antes de confirmar
              su recepción.
            </span>
            <span>Horario de recepción: Lima (UTC−5)</span>
          </footer>
        </main>
      </div>
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={
          <span>
            <CodeOutlined /> Detalle del evento
          </span>
        }
        size={Math.min(window.innerWidth, 740)}
        extra={
          <Space>
            <Tooltip title="Copiar JSON">
              <Button
                icon={<CopyOutlined />}
                disabled={!detail}
                aria-label="Copiar JSON"
                onClick={() => {
                  if (detail)
                    navigator.clipboard
                      .writeText(JSON.stringify(detail.payload, null, 2))
                      .then(() => message.success("JSON copiado"))
                      .catch(() => message.error("No se pudo copiar el JSON"));
                }}
              />
            </Tooltip>
            <Button
              icon={<DownloadOutlined />}
              disabled={!detail}
              onClick={download}
            >
              JSON
            </Button>
          </Space>
        }
      >
        <div className="detail-content">
          {detailError ? (
            <Alert
              type="error"
              showIcon
              title={detailError}
              action={
                <Button
                  onClick={() => {
                    setSelected(null);
                  }}
                >
                  Cerrar
                </Button>
              }
            />
          ) : !detail ? (
            <Skeleton active />
          ) : (
            <>
              <Tag icon={<CheckCircleOutlined />} color="success">
                Guardado
              </Tag>
              <h2>{detail.event_code}</h2>
              <Descriptions
                column={1}
                size="small"
                items={[
                  {
                    key: "id",
                    label: "ID del evento",
                    children: (
                      <Typography.Text copyable className="detail-id">
                        {detail.request_id}
                      </Typography.Text>
                    ),
                  },
                  {
                    key: "date",
                    label: "Recibido en Lima",
                    children: date(detail.received_at),
                  },
                  {
                    key: "origin",
                    label: "Origen",
                    children:
                      detail.event_code === "integration.test"
                        ? "Prueba de integración"
                        : "ZKBio Zlink",
                  },
                ]}
              />
              <div className="payload-heading">
                <h3>Contenido del evento</h3>
                <Tabs
                  size="small"
                  activeKey={jsonMode}
                  onChange={setJsonMode}
                  items={[
                    { key: "tree", label: "Árbol" },
                    { key: "raw", label: "JSON" },
                  ]}
                />
              </div>
              <div className="json-content">
                {jsonMode === "tree" ? (
                  <JsonView
                    value={detail.payload}
                    collapsed={2}
                    displayDataTypes={false}
                    shortenTextAfterLength={100}
                    enableClipboard={false}
                    style={{
                      fontSize: 13,
                      lineHeight: "1.8",
                      backgroundColor: "transparent",
                    }}
                  />
                ) : (
                  <pre>{JSON.stringify(detail.payload, null, 2)}</pre>
                )}
              </div>
              <p className="detail-note">
                <LockOutlined /> Contenido original descifrado. Esta vista es de
                solo lectura.
              </p>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={esES}
      theme={{
        token: {
          colorPrimary: "#136b9a",
          fontFamily: '"IBM Plex Sans", sans-serif',
          borderRadius: 7,
          colorText: "#183044",
          colorTextSecondary: "#607487",
          colorBorder: "#dce5ec",
          controlHeight: 38,
        },
        components: {
          Table: {
            headerBg: "#f7f9fb",
            headerColor: "#617589",
            rowHoverBg: "#f0f7fb",
            cellPaddingBlock: 17,
          },
          Button: { controlHeight: 40 },
          Drawer: { paddingLG: 28 },
        },
      }}
    >
      <AntApp>
        <EventsApp />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
