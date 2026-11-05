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
import enUS from "antd/locale/en_US";
import { useTranslation } from "react-i18next";
import "./i18n";
import { api, errorKey } from "./api";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { UserManagement, type Account } from "./users";
import { Dashboard } from "./dashboard";
const Integration = React.lazy(() =>
  import("./integration").then((module) => ({ default: module.Integration })),
);
import {
  GlobalOutlined,
  DashboardOutlined,
  TeamOutlined,
  ApiOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
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

const Logo = () => (
  <span className="brand-mark" aria-hidden="true">
    <ApiOutlined />
  </span>
);

function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <Select
      className="language-selector"
      aria-label={t("common.language")}
      prefix={<GlobalOutlined aria-hidden="true" />}
      value={i18n.resolvedLanguage === "en" ? "en" : "es"}
      onChange={(value) => void i18n.changeLanguage(value)}
      options={[
        { value: "es", label: "Español" },
        { value: "en", label: "English" },
      ]}
    />
  );
}

function EventsApp() {
  const location = useLocation(),
    navigate = useNavigate();
  const view =
    location.pathname === "/integration"
      ? "integration"
      : location.pathname === "/users"
        ? "users"
        : location.pathname === "/events"
          ? "events"
          : "dashboard";
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage === "en" ? "en" : "es";
  const size = (bytes: number) =>
    bytes < 1024
      ? `${bytes} B`
      : `${new Intl.NumberFormat(language === "en" ? "en-US" : "es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / 1024)} KB`;
  const number = new Intl.NumberFormat(language === "en" ? "en-US" : "es-PE");
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
      ? new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-PE", {
          timeZone: "America/Lima",
          hour12: false,
          ...options,
        }).format(new Date(value))
      : t("summary.none");

  const [loginForm] = Form.useForm();
  useEffect(() => {
    const invalid = loginForm
      .getFieldsError()
      .filter((field) => field.errors.length)
      .map((field) => field.name);
    if (invalid.length) void loginForm.validateFields(invalid).catch(() => {});
  }, [language, loginForm]);
  const { message } = AntApp.useApp();
  const [user, setUser] = useState<Account | null>(null),
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
    api<Account>("/session")
      .then((r) => setUser(r))
      .catch((e) => {
        if (e.status !== 401) setLoginError(errorKey(e));
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
    setLoginError("errors.session");
  }, []);
  useEffect(() => {
    if (
      !user ||
      !user.permissions.includes("events.read") ||
      (view !== "events" && view !== "dashboard")
    )
      return;
    const controller = new AbortController(),
      id = ++sequence.current;
    const params = new URLSearchParams({
      q: view === "events" ? query : "",
      event_code: view === "events" ? code || "" : "",
      page: String(view === "events" ? page : 1),
      page_size: String(view === "events" ? pageSize : 5),
      order: view === "events" ? order : "desc",
    });
    if (view === "events" && period === "custom" && range) {
      params.set("since", range[0]);
      params.set("until", range[1]);
    } else if (view === "events" && period !== "all" && period !== "custom")
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
        if (
          view === "events" &&
          page > 1 &&
          rows.items.length === 0 &&
          rows.total > 0
        ) {
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
        else setError(errorKey(e));
      })
      .finally(() => {
        if (sequence.current === id) setBusy(false);
      });
    return () => controller.abort();
  }, [
    user,
    query,
    code,
    period,
    range,
    page,
    pageSize,
    order,
    tick,
    expire,
    view,
  ]);
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
        else setDetailError(errorKey(e));
      });
    return () => controller.abort();
  }, [selected, user, expire]);
  async function login(values: { username: string; password: string }) {
    setLoginBusy(true);
    setLoginError("");
    try {
      const r = await api<Account>("/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setUser(r);
      navigate("/dashboard");
      setTick((t) => t + 1);
    } catch (e) {
      setLoginError(errorKey(e));
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
      message.error(t("errors.logout"));
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
      title: t("table.event"),
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
              {value === "integration.test" ? t("detail.test") : "ZKBio Zlink"}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t("table.id"),
      dataIndex: "request_id",
      width: 270,
      render: (value: string) => (
        <Tooltip title={value}>
          <span className="request-id">{value}</span>
        </Tooltip>
      ),
    },
    {
      title: t("table.received"),
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
      title: t("table.status"),
      width: 135,
      render: () => (
        <Tag icon={<CheckCircleOutlined />} color="success" bordered={false}>
          {t("common.saved")}
        </Tag>
      ),
    },
    {
      title: t("table.size"),
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
        <Tooltip title={t("detail.open")}>
          <Button
            type="text"
            icon={<ArrowRightOutlined />}
            aria-label={t("detail.openId", { id: row.request_id })}
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
        <span>{t("common.opening")}</span>
      </div>
    );
  if (!user)
    return (
      <main className="login-page">
        <section className="login-story">
          <div className="brand">
            <Logo />
            <span>
              ZLINK<span className="brand-sub">{t("brand.console")}</span>
            </span>
          </div>
          <div className="login-headline">
            <span className="small-label">{t("login.tagline")}</span>
            <h1>
              {t("login.headline1")}
              <br />
              {t("login.headline2")}
            </h1>
            <p>{t("login.description")}</p>
            <div className="login-trace" aria-hidden="true">
              <div>
                <span className="trace-dot" />
                <span>{t("login.received")}</span>
                <CheckCircleOutlined />
              </div>
              <div>
                <span className="trace-line" />
              </div>
              <div>
                <span className="trace-dot" />
                <span>{t("login.verified")}</span>
                <CheckCircleOutlined />
              </div>
              <div>
                <span className="trace-line" />
              </div>
              <div>
                <span className="trace-dot" />
                <span>{t("login.ready")}</span>
                <ArrowRightOutlined />
              </div>
            </div>
          </div>
          <span className="login-bottom">{t("login.footer")}</span>
        </section>
        <section className="login-form">
          <div className="login-language">
            <LanguageSwitcher />
          </div>
          <div className="form-inner">
            <span className="login-lock">
              <LockOutlined />
            </span>
            <h2>{t("login.welcome")}</h2>
            <p>{t("login.intro")}</p>
            {loginError && (
              <Alert
                type="error"
                showIcon
                title={t(loginError)}
                className="form-alert"
              />
            )}
            <Form
              form={loginForm}
              layout="vertical"
              onFinish={login}
              initialValues={{ username: "trok" }}
              requiredMark={false}
            >
              <Form.Item
                label={t("login.username")}
                name="username"
                rules={[
                  { required: true, message: t("login.usernameRequired") },
                ]}
              >
                <Input autoComplete="username" size="large" />
              </Form.Item>
              <Form.Item
                label={t("login.password")}
                name="password"
                rules={[
                  { required: true, message: t("login.passwordRequired") },
                ]}
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
                {t("login.submit")}
                <ArrowRightOutlined />
              </Button>
            </Form>
            <div className="private-note">
              <LockOutlined />
              {t("login.private")}
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
            ZLINK<span className="brand-sub">{t("brand.console")}</span>
          </span>
        </div>
        <div className="workspace-label">{t("nav.workspace")}</div>
        <nav>
          <a
            href="/dashboard"
            onClick={(e) => {
              e.preventDefault();
              navigate("/dashboard");
            }}
            className={view === "dashboard" ? "nav-active" : ""}
          >
            <DashboardOutlined />
            {t("nav.dashboard")}
          </a>
          {user.permissions.includes("events.read") && (
            <a
              href="/events"
              onClick={(e) => {
                e.preventDefault();
                navigate("/events");
              }}
              className={view === "events" ? "nav-active" : ""}
            >
              <ThunderboltOutlined />
              {t("nav.events")}{" "}
              <span className="nav-count">{number.format(summary.total)}</span>
            </a>
          )}
          {user.permissions.includes("users.manage") && (
            <a
              href="/users"
              onClick={(e) => {
                e.preventDefault();
                navigate("/users");
              }}
              className={view === "users" ? "nav-active" : ""}
            >
              <TeamOutlined />
              {t("nav.users")}
            </a>
          )}
          {user.permissions.some((value) =>
            ["api.read", "api.write"].includes(value),
          ) && (
            <a
              href="/integration"
              className={view === "integration" ? "nav-active" : ""}
              onClick={(event) => {
                event.preventDefault();
                navigate("/integration");
              }}
            >
              <ApiOutlined />
              {t("nav.api")}
            </a>
          )}{" "}
        </nav>
        <div className="source-panel">
          <CloudServerOutlined />
          <span>
            {t("nav.source")}
            <strong>ZKBio Zlink</strong>
          </span>
        </div>
        <div className="sidebar-bottom">
          <div className="avatar">T</div>
          <div>
            <strong>TROK</strong>
            <span>{t("nav.console")}</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            <span>{t("nav.integrations")}</span>
            <span>/</span>
            <strong>
              {t(
                view === "integration"
                  ? "nav.api"
                  : view === "users"
                    ? "nav.users"
                    : view === "dashboard"
                      ? "nav.dashboard"
                      : "nav.events",
              )}
            </strong>
          </span>
          <div className="account">
            <Select
              className="mobile-nav"
              aria-label={t("nav.navigate")}
              value={view}
              onChange={(value) => navigate("/" + value)}
              options={[
                { value: "dashboard", label: t("nav.dashboard") },
                ...(user.permissions.some((value) =>
                  ["api.read", "api.write"].includes(value),
                )
                  ? [{ value: "integration", label: t("nav.api") }]
                  : []),
                ...(user.permissions.includes("events.read")
                  ? [{ value: "events", label: t("nav.events") }]
                  : []),
                ...(user.permissions.includes("users.manage")
                  ? [{ value: "users", label: t("nav.users") }]
                  : []),
              ]}
            />
            <LanguageSwitcher />
            <LockOutlined />
            <span>{user.display_name || user.username}</span>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={logout}
              aria-label={t("nav.logout")}
            />
          </div>
        </header>
        <main className="main-content">
          {view === "integration" ? (
            <React.Suspense fallback={<Skeleton active />}>
              <Integration account={user} onExpired={expire} />
            </React.Suspense>
          ) : view === "users" ? (
            <UserManagement account={user} onExpired={expire} />
          ) : (
            <>
              <div className="page-section">
                <div className="page-heading">
                  <div>
                    <div className="page-kicker">
                      <span className="connector-line" /> ZKBio Zlink
                    </div>
                    <h1>
                      {t(
                        view === "dashboard" ? "dashboard.title" : "page.title",
                      )}
                    </h1>
                    <p>
                      {t(
                        view === "dashboard"
                          ? "dashboard.description"
                          : "page.description",
                      )}
                    </p>
                  </div>
                  <Button
                    icon={<ReloadOutlined spin={busy} />}
                    onClick={() => setTick((t) => t + 1)}
                    disabled={busy}
                  >
                    {t("common.refresh")}
                  </Button>
                </div>
                {user.permissions.includes("events.read") && (
                  <>
                    <section
                      className="overview"
                      aria-label={t("summary.label")}
                    >
                      <div>
                        <span>{t("summary.total")}</span>
                        <strong>{number.format(summary.total)}</strong>
                        <small>{t("summary.inbox")}</small>
                      </div>
                      <div>
                        <span>{t("summary.today")}</span>
                        <strong>{number.format(summary.today)}</strong>
                        <small>{t("summary.midnight")}</small>
                      </div>
                      <div>
                        <span>{t("summary.types")}</span>
                        <strong>
                          {number.format(summary.event_codes.length)}
                        </strong>
                        <small>{t("summary.unique")}</small>
                      </div>
                      <div className="last-event">
                        <span>{t("summary.last")}</span>
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
                            : t("summary.waiting")}
                        </small>
                      </div>
                    </section>
                    {error && (
                      <Alert
                        className="data-error"
                        type="error"
                        showIcon
                        title={t("inbox.failure")}
                        description={t(error)}
                        action={
                          <Button onClick={() => setTick((t) => t + 1)}>
                            {t("common.retry")}
                          </Button>
                        }
                      />
                    )}
                    {view === "dashboard" ? (
                      <Dashboard
                        summary={summary}
                        items={data.items}
                        columns={columns}
                        loading={busy && !updated}
                        onExplore={() => navigate("/events")}
                      />
                    ) : (
                      <section className="event-panel">
                        <div className="panel-title">
                          <div>
                            <h2>
                              {t("inbox.title")}
                              <span>{number.format(data.total)}</span>
                            </h2>
                            <p>{t("inbox.description")}</p>
                          </div>
                          <div className="auto-control">
                            <Switch
                              checked={auto}
                              onChange={setAuto}
                              size="small"
                              aria-label={t("inbox.autoLabel")}
                            />
                            <span>{t("inbox.auto")}</span>
                          </div>
                        </div>
                        <div className="filters">
                          <Input
                            className="search"
                            prefix={<SearchOutlined />}
                            placeholder={t("filters.searchPlaceholder")}
                            aria-label={t("filters.searchLabel")}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            allowClear
                          />
                          <Select
                            aria-label={t("filters.type")}
                            placeholder={t("filters.allTypes")}
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
                            aria-label={t("filters.period")}
                            value={period}
                            onChange={(v) => {
                              setPeriod(v);
                              setPage(1);
                            }}
                            options={[
                              { value: "all", label: t("filters.allTime") },
                              { value: "1", label: t("filters.day") },
                              { value: "7", label: t("filters.week") },
                              { value: "30", label: t("filters.month") },
                              { value: "custom", label: t("filters.custom") },
                            ]}
                          />
                          <Select
                            aria-label={t("filters.order")}
                            value={order}
                            onChange={(v) => {
                              setOrder(v);
                              setPage(1);
                            }}
                            options={[
                              { value: "desc", label: t("filters.newest") },
                              { value: "asc", label: t("filters.oldest") },
                            ]}
                          />
                        </div>
                        {period === "custom" && (
                          <div className="custom-range">
                            <label>
                              {t("filters.dates")}{" "}
                              <DatePicker.RangePicker
                                aria-label={t("filters.range")}
                                format={
                                  language === "en"
                                    ? "MM/DD/YYYY"
                                    : "DD/MM/YYYY"
                                }
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
                            <span>{t("filters.browserTimezone")}</span>
                          </div>
                        )}
                        {activeFilters && (
                          <div className="filter-status">
                            <FilterOutlined />
                            <span>
                              {t("filters.results", { count: data.total })}
                            </span>
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
                              {t("filters.clear")}
                            </Button>
                          </div>
                        )}
                        <Table<EventRow>
                          rowKey="request_id"
                          columns={columns}
                          dataSource={data.items}
                          loading={busy && !updated}
                          scroll={{ x: 1020 }}
                          pagination={{
                            current: page,
                            pageSize,
                            total: data.total,
                            showSizeChanger: true,
                            pageSizeOptions: [10, 25, 50, 100],
                            showTotal: (total) =>
                              t("table.count", { count: total }),
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
                                        ? t("empty.title")
                                        : t("empty.ready")}
                                    </strong>
                                    <p>
                                      {activeFilters
                                        ? t("empty.filtered")
                                        : t("empty.inbox")}
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
                              status={
                                error
                                  ? "error"
                                  : auto
                                    ? "processing"
                                    : "default"
                              }
                            />
                            {error
                              ? t("inbox.interrupted")
                              : auto
                                ? t("inbox.active")
                                : t("inbox.paused")}
                          </span>
                          <span aria-live="polite">
                            {updated
                              ? t("inbox.updated", {
                                  time: date(updated, {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  }),
                                })
                              : t("inbox.loading")}
                          </span>
                        </div>
                      </section>
                    )}
                    <footer className="page-footer">
                      <span>
                        <CheckCircleOutlined />
                        {t("inbox.guarantee")}
                      </span>
                      <span>{t("inbox.timezone")}</span>
                    </footer>
                  </>
                )}
                {!user.permissions.includes("events.read") && (
                  <Alert type="info" title={t("dashboard.noEvents")} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={
          <span>
            <CodeOutlined />
            {t("detail.title")}
          </span>
        }
        size={Math.min(window.innerWidth, 740)}
        extra={
          <Space>
            <Tooltip title={t("detail.copy")}>
              <Button
                icon={<CopyOutlined />}
                disabled={!detail}
                aria-label={t("detail.copy")}
                onClick={() => {
                  if (detail)
                    navigator.clipboard
                      .writeText(JSON.stringify(detail.payload, null, 2))
                      .then(() => message.success(t("detail.copied")))
                      .catch(() => message.error(t("detail.copyFailed")));
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
              title={t(detailError)}
              action={
                <Button
                  onClick={() => {
                    setSelected(null);
                  }}
                >
                  {t("common.close")}
                </Button>
              }
            />
          ) : !detail ? (
            <Skeleton active />
          ) : (
            <>
              <Tag icon={<CheckCircleOutlined />} color="success">
                {t("common.saved")}
              </Tag>
              <h2>{detail.event_code}</h2>
              <Descriptions
                column={1}
                size="small"
                items={[
                  {
                    key: "id",
                    label: t("detail.id"),
                    children: (
                      <Typography.Text copyable className="detail-id">
                        {detail.request_id}
                      </Typography.Text>
                    ),
                  },
                  {
                    key: "date",
                    label: t("detail.received"),
                    children: date(detail.received_at),
                  },
                  {
                    key: "origin",
                    label: t("detail.source"),
                    children:
                      detail.event_code === "integration.test"
                        ? t("detail.test")
                        : "ZKBio Zlink",
                  },
                ]}
              />
              <div className="payload-heading">
                <h3>{t("detail.content")}</h3>
                <Tabs
                  size="small"
                  activeKey={jsonMode}
                  onChange={setJsonMode}
                  items={[
                    { key: "tree", label: t("detail.tree") },
                    { key: "raw", label: "JSON" },
                  ]}
                />
              </div>
              <div className="json-content">
                {jsonMode === "tree" ? (
                  <JsonView
                    key={language}
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
                  >
                    <JsonView.CountInfo
                      render={(props, { value }) => (
                        <span {...props}>
                          {t("detail.items", {
                            count: Object.keys(value || {}).length,
                          })}
                        </span>
                      )}
                    />
                  </JsonView>
                ) : (
                  <pre>{JSON.stringify(detail.payload, null, 2)}</pre>
                )}
              </div>
              <p className="detail-note">
                <LockOutlined />
                {t("detail.note")}
              </p>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}

function LocalizedApp() {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage === "en" ? "en" : "es";
  dayjs.locale(language);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `ZLINK · ${t(pathname === "/users" ? "nav.users" : pathname === "/integration" ? "nav.api" : pathname === "/events" ? "nav.events" : "nav.dashboard")}`;
  }, [language, t, pathname]);
  return (
    <ConfigProvider
      locale={language === "en" ? enUS : esES}
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
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LocalizedApp />
    </BrowserRouter>
  </React.StrictMode>,
);
