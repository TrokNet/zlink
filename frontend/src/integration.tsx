import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Tabs,
  Typography,
  Upload,
} from "antd";
import {
  ApiOutlined,
  BookOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import JsonForm from "@rjsf/antd";
import { customizeValidator } from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema, WidgetProps } from "@rjsf/utils";
import localizeEs from "ajv-i18n/localize/es";
import localizeHi from "./localizeHi";
import JsonView from "@uiw/react-json-view";
import { useTranslation } from "react-i18next";
import { api, errorKey } from "./api";
import type { Account } from "./users";

type Operation = {
  id: string;
  title: string;
  sections: string[];
  source: string;
  method: string;
  path: string;
  schema: RJSFSchema;
  example: unknown;
  kind: "query" | "mutation" | "connection";
};
type Guide = { id: string; title: string; sections: string[]; source: string };
type Catalog = { operations: Operation[]; guides: Guide[]; articles: number };
type Result = { http_status: number; duration_ms: number; body: unknown };
type WorkspaceTab = "request" | "response" | "history" | "guides";
type RequestWorkspace = {
  inputs: Record<string, unknown>;
  result: Result | null;
  error: string;
  busy: boolean;
  tab: WorkspaceTab;
  history: Record<string, unknown>[];
};

function emptyWorkspace(): RequestWorkspace {
  return {
    inputs: {},
    result: null,
    error: "",
    busy: false,
    tab: "request",
    history: [],
  };
}

function methodColor(method: string) {
  switch (method.toUpperCase()) {
    case "GET":
      return "blue";
    case "POST":
      return "green";
    case "PUT":
      return "gold";
    case "PATCH":
      return "purple";
    case "DELETE":
      return "red";
    default:
      return "default";
  }
}

function NumericInput(props: WidgetProps) {
  return (
    <InputNumber
      id={props.id}
      aria-label={props.label}
      controls={false}
      style={{ width: "100%" }}
      value={props.value ?? null}
      min={
        typeof props.schema.minimum === "number"
          ? props.schema.minimum
          : undefined
      }
      max={
        typeof props.schema.maximum === "number"
          ? props.schema.maximum
          : undefined
      }
      onChange={(value) => props.onChange(value ?? undefined)}
      disabled={props.disabled || props.readonly}
    />
  );
}

function Base64Image(props: WidgetProps & { includeMimeType?: boolean }) {
  const { t } = useTranslation(),
    { message } = App.useApp();
  const includeMimeType = props.includeMimeType === true;
  return (
    <div>
      <Upload
        accept="image/*"
        maxCount={1}
        showUploadList={false}
        beforeUpload={(file) => {
          if (file.size > 750000) {
            message.error(t("api.imageSize"));
            return false;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result);
            props.onChange(includeMimeType ? dataUrl : dataUrl.split(",")[1]);
          };
          reader.readAsDataURL(file);
          return false;
        }}
      >
        <Button icon={<UploadOutlined />}>{t("api.image")}</Button>
      </Upload>
      <Input.TextArea
        id={props.id}
        aria-label={props.label}
        value={String(props.value || "")}
        rows={3}
        onChange={(event) => props.onChange(event.target.value || undefined)}
        placeholder={t(includeMimeType ? "api.base64WithMime" : "api.base64")}
      />
      {includeMimeType && (
        <Typography.Text type="secondary">
          {t("api.imageMimeHint")}
        </Typography.Text>
      )}
    </div>
  );
}

function imageDataUrl(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, "");
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(compact)) return compact;
  const mimeType = compact.startsWith("/9j/")
    ? "image/jpeg"
    : compact.startsWith("iVBOR")
      ? "image/png"
      : compact.startsWith("R0lGOD")
        ? "image/gif"
        : compact.startsWith("UklGR")
          ? "image/webp"
          : null;
  return mimeType ? `data:${mimeType};base64,${compact}` : null;
}

function normalizeImageInput(
  operation: Operation,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const registrationPath = "/open-apis/cms/v1/credentials/visibleLightFace";
  const detectionPath = `${registrationPath}/detect`;
  if (operation.path !== registrationPath && operation.path !== detectionPath)
    return data;
  const field = operation.path === registrationPath ? "content" : "bioPhoto";
  if (!data.body || typeof data.body !== "object" || Array.isArray(data.body))
    return data;
  const body = data.body as Record<string, unknown>;
  if (typeof body[field] !== "string") return data;
  const value = body[field] as string;
  if (operation.path === registrationPath) {
    const normalized = imageDataUrl(value);
    return normalized
      ? { ...data, body: { ...body, [field]: normalized } }
      : null;
  }
  const normalized = value
    .trim()
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
    .replace(/\s+/g, "");
  return { ...data, body: { ...body, [field]: normalized } };
}

export function Integration({
  account,
  onExpired,
}: {
  account: Account;
  onExpired: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || "es";
  const { modal } = App.useApp();
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [selected, setSelected] = useState(""),
    [openRequests, setOpenRequests] = useState<string[]>([]),
    [workspaces, setWorkspaces] = useState<Record<string, RequestWorkspace>>(
      {},
    ),
    [search, setSearch] = useState(""),
    [expandedGroups, setExpandedGroups] = useState<string[]>([]),
    [catalogError, setCatalogError] = useState(""),
    [configured, setConfigured] = useState(false);
  const label = (op: Operation | Guide) =>
    t("operations." + op.id, { defaultValue: op.title });
  useEffect(() => {
    let active = true;
    Promise.all([
      api<Catalog>("/integration/catalog"),
      api<{ configured: boolean }>("/integration/status"),
    ])
      .then(([c, s]) => {
        if (active) {
          setCatalog(c);
          setConfigured(s.configured);
          const initialOperation =
            c.operations.find((x) => x.kind === "connection") ||
            c.operations[0];
          if (initialOperation) {
            setSelected(initialOperation.id);
            setOpenRequests([initialOperation.id]);
            setWorkspaces({ [initialOperation.id]: emptyWorkspace() });
          }
          setExpandedGroups([
            ...new Set(c.operations.map((operation) => operation.sections[0])),
          ]);
        }
      })
      .catch((e) => {
        if (e.status === 401) onExpired();
        else if (active) setCatalogError(errorKey(e));
      });
    return () => {
      active = false;
    };
  }, [onExpired]);
  const operation = catalog?.operations.find((item) => item.id === selected);
  const workspace = workspaces[selected] ?? emptyWorkspace();
  const openOperations =
    catalog?.operations.filter((item) => openRequests.includes(item.id)) || [];
  function updateWorkspace(
    id: string,
    update:
      | Partial<RequestWorkspace>
      | ((current: RequestWorkspace) => RequestWorkspace),
  ) {
    setWorkspaces((current) => {
      const previous = current[id] ?? emptyWorkspace();
      const next =
        typeof update === "function"
          ? update(previous)
          : { ...previous, ...update };
      return { ...current, [id]: next };
    });
  }
  function choose(id: string) {
    setOpenRequests((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setWorkspaces((current) =>
      current[id] ? current : { ...current, [id]: emptyWorkspace() },
    );
    setSelected(id);
    const section = catalog?.operations.find((item) => item.id === id)
      ?.sections[0];
    if (section)
      setExpandedGroups((current) =>
        current.includes(section) ? current : [...current, section],
      );
  }
  function closeRequest(id: string) {
    const index = openRequests.indexOf(id);
    const remaining = openRequests.filter((requestId) => requestId !== id);
    setOpenRequests(remaining);
    setWorkspaces((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (selected === id)
      setSelected(remaining[Math.min(index, remaining.length - 1)] || "");
  }
  const validator = useMemo(
    () =>
      customizeValidator(
        {},
        language === "es"
          ? localizeEs
          : language === "hi"
            ? localizeHi
            : undefined,
      ),
    [language],
  );
  function localizeSchema(input: RJSFSchema, name = ""): RJSFSchema {
    const out = { ...input };
    if (name) out.title = t("fields." + name, { defaultValue: name });
    if (input.properties)
      out.properties = Object.fromEntries(
        Object.entries(input.properties).map(([key, value]) => [
          key,
          typeof value === "object" ? localizeSchema(value, key) : value,
        ]),
      );
    if (
      input.items &&
      typeof input.items === "object" &&
      !Array.isArray(input.items)
    )
      out.items = localizeSchema(input.items);
    return out;
  }
  function makeUi(schema: RJSFSchema): UiSchema {
    const ui: UiSchema = { "ui:submitButtonOptions": { norender: true } };
    for (const [key, value] of Object.entries(schema.properties || {})) {
      if (typeof value === "object") {
        ui[key] = makeUi(value);
        if (value.type === "integer" || value.type === "number")
          ui[key] = { "ui:widget": "numberInput" };
        if (["content", "bioPhoto"].includes(key))
          ui[key] = { "ui:widget": "base64" };
        if (
          value.type === "array" &&
          value.items &&
          typeof value.items === "object" &&
          !Array.isArray(value.items)
        )
          ui[key].items = makeUi(value.items);
      }
    }
    return ui;
  }
  async function refreshHistory(operationId: string) {
    try {
      const { items } = await api<{ items: Record<string, unknown>[] }>(
        "/integration/history",
      );
      updateWorkspace(operationId, { history: items });
    } catch (e) {
      if ((e as { status?: number }).status === 401) onExpired();
    }
  }
  async function execute(
    requestOperation: Operation,
    data: Record<string, unknown>,
    confirmed = false,
  ) {
    const normalizedData = normalizeImageInput(requestOperation, data);
    if (!normalizedData) {
      updateWorkspace(requestOperation.id, { error: "api.imageMimeRequired" });
      return;
    }
    if (requestOperation.kind === "mutation" && !confirmed) {
      modal.confirm({
        title: t("api.confirmTitle"),
        content: t("api.confirmBody", { name: label(requestOperation) }),
        okText: t("api.confirmExecute"),
        cancelText: t("common.cancel"),
        okButtonProps: { danger: true },
        onOk: () => execute(requestOperation, normalizedData, true),
      });
      return;
    }
    updateWorkspace(requestOperation.id, {
      busy: true,
      error: "",
      result: null,
    });
    try {
      const r = await api<Result>(
        `/integration/execute/${requestOperation.id}`,
        {
          method: "POST",
          body: JSON.stringify({ inputs: normalizedData, confirmed }),
        },
      );
      updateWorkspace(requestOperation.id, { result: r, tab: "response" });
      await refreshHistory(requestOperation.id);
    } catch (e) {
      if ((e as { status?: number }).status === 401) onExpired();
      else
        updateWorkspace(requestOperation.id, {
          error: errorKey(e),
          tab: "response",
        });
    } finally {
      updateWorkspace(requestOperation.id, { busy: false });
    }
  }
  const canExecute =
    operation &&
    account.permissions.includes(
      operation.kind === "mutation" ? "api.write" : "api.read",
    );
  const filtered =
    catalog?.operations.filter((op) =>
      `${label(op)} ${op.path} ${op.method}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  const groupedOperations = new Map<string, Operation[]>();
  for (const item of filtered) {
    const section = item.sections[0] || "Other";
    groupedOperations.set(section, [
      ...(groupedOperations.get(section) || []),
      item,
    ]);
  }
  const connection = catalog?.operations.find((op) => op.kind === "connection");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="page-kicker">
            <ApiOutlined /> ZKBio Zlink
          </div>
          <h1>{t("api.title")}</h1>
          <p>
            {t("api.subtitle", {
              operations: catalog?.operations.length || 0,
              articles: catalog?.articles || 52,
            })}
          </p>
        </div>
        <Button
          icon={<CheckCircleOutlined />}
          loading={workspace.busy && operation?.kind === "connection"}
          disabled={!connection || !account.permissions.includes("api.read")}
          onClick={() => connection && choose(connection.id)}
        >
          {t("api.connection")}
        </Button>
      </div>
      <Alert
        type={configured ? "info" : "warning"}
        showIcon
        title={t(configured ? "api.configured" : "api.notConfigured")}
        className="data-error"
      />
      {catalogError && (
        <Alert
          type="error"
          showIcon
          title={t(catalogError)}
          className="data-error"
        />
      )}
      <div className="api-layout">
        <aside className="event-panel api-navigation">
          <div className="api-search">
            <Input.Search
              placeholder={t("api.search")}
              aria-label={t("api.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Collapse
            className="operation-groups"
            ghost
            activeKey={expandedGroups}
            onChange={(keys) =>
              setExpandedGroups(Array.isArray(keys) ? keys : [keys])
            }
            items={[...groupedOperations.entries()].map(([section, items]) => ({
              key: section,
              label: (
                <span className="operation-group-label">
                  <span>
                    {t("sections." + section, { defaultValue: section })}
                  </span>
                  <Tag>{items.length}</Tag>
                </span>
              ),
              children: items.map((item) => (
                <button
                  key={item.id}
                  className={`operation-entry${selected === item.id ? " selected" : ""}`}
                  onClick={() => choose(item.id)}
                  aria-current={selected === item.id ? "page" : undefined}
                >
                  <span className="operation-entry-meta">
                    <Tag color={methodColor(item.method)}>{item.method}</Tag>
                  </span>
                  <strong>{label(item)}</strong>
                  <code>{item.path}</code>
                </button>
              )),
            }))}
          />
        </aside>
        <section className="event-panel api-workbench">
          <Tabs
            className="api-request-tabs"
            type="editable-card"
            hideAdd
            activeKey={selected || undefined}
            onChange={choose}
            onEdit={(targetKey, action) => {
              if (action === "remove" && typeof targetKey === "string")
                closeRequest(targetKey);
            }}
            items={openOperations.map((item) => ({
              key: item.id,
              label: (
                <span className="api-request-tab-label">
                  <Tag color={methodColor(item.method)}>{item.method}</Tag>
                  <span>{label(item)}</span>
                </span>
              ),
              children: null,
            }))}
          />
          {operation ? (
            <>
              <div className="panel-title">
                <div>
                  <h2>{label(operation)}</h2>
                  <p>
                    <Tag color={methodColor(operation.method)}>
                      {operation.method}
                    </Tag>
                    <code>{operation.path}</code>
                  </p>
                </div>
                <a href={operation.source} target="_blank" rel="noreferrer">
                  <BookOutlined /> {t("api.reference")}
                </a>
              </div>
              <div className="api-workbench-body">
                <Tabs
                  activeKey={workspace.tab}
                  onChange={(value) => {
                    updateWorkspace(operation.id, {
                      tab: value as WorkspaceTab,
                    });
                    if (value === "history") void refreshHistory(operation.id);
                  }}
                  items={[
                    { key: "request", label: t("api.request") },
                    { key: "response", label: t("api.response") },
                    { key: "history", label: t("api.history") },
                    { key: "guides", label: t("api.guides") },
                  ]}
                />
                {workspace.tab === "request" && (
                  <>
                    {operation.kind === "mutation" && (
                      <Alert
                        type="warning"
                        showIcon
                        title={t("api.mutation")}
                        className="form-alert"
                      />
                    )}
                    {operation.kind === "connection" ? (
                      <p>{t("api.tokenHint")}</p>
                    ) : (
                      <JsonForm
                        key={operation.id + "-" + language}
                        schema={localizeSchema(operation.schema)}
                        uiSchema={makeUi(operation.schema)}
                        validator={validator}
                        widgets={{
                          base64: (props) => (
                            <Base64Image
                              {...props}
                              includeMimeType={
                                operation.path ===
                                "/open-apis/cms/v1/credentials/visibleLightFace"
                              }
                            />
                          ),
                          numberInput: NumericInput,
                        }}
                        formData={workspace.inputs}
                        onChange={(event) =>
                          updateWorkspace(operation.id, {
                            inputs: event.formData || {},
                          })
                        }
                        onSubmit={(event) =>
                          void execute(operation, event.formData || {})
                        }
                        noHtml5Validate
                        showErrorList="top"
                        translateString={(id, params) => {
                          let value = t("rjsf." + id, { defaultValue: id });
                          params?.forEach((item, index) => {
                            value = value.replaceAll(
                              "%" + (index + 1),
                              String(item),
                            );
                          });
                          return value;
                        }}
                      >
                        <Button
                          type="primary"
                          htmlType="submit"
                          icon={<PlayCircleOutlined />}
                          loading={workspace.busy}
                          disabled={!canExecute}
                        >
                          {t("api.execute")}
                        </Button>
                      </JsonForm>
                    )}
                    {operation.kind === "connection" && (
                      <Button
                        type="primary"
                        loading={workspace.busy}
                        disabled={!canExecute}
                        onClick={() => void execute(operation, {})}
                        icon={<PlayCircleOutlined />}
                      >
                        {t("api.execute")}
                      </Button>
                    )}
                    <Space wrap className="api-form-actions">
                      {operation.example !== null && (
                        <Button
                          disabled={workspace.busy}
                          onClick={() => {
                            updateWorkspace(operation.id, {
                              inputs: { body: operation.example },
                              result: null,
                              error: "",
                            });
                          }}
                        >
                          {t("api.example")}
                        </Button>
                      )}
                      <Button
                        onClick={() => {
                          updateWorkspace(operation.id, {
                            inputs: {},
                            result: null,
                            error: "",
                          });
                        }}
                        disabled={workspace.busy}
                      >
                        {t("api.clear")}
                      </Button>
                    </Space>
                    {!canExecute && (
                      <Alert type="info" title={t("api.noPermission")} />
                    )}
                    <Collapse
                      ghost
                      items={[
                        {
                          key: "schema",
                          label: t("api.schema"),
                          children: (
                            <pre className="raw-json">
                              {JSON.stringify(operation.schema, null, 2)}
                            </pre>
                          ),
                        },
                      ]}
                    />
                  </>
                )}
                {workspace.error && (
                  <Alert
                    type="error"
                    showIcon
                    title={t(workspace.error)}
                    className="data-error"
                  />
                )}
                {(workspace.tab === "response" ||
                  workspace.tab === "request") &&
                  workspace.result && (
                    <div className="api-result">
                      <div className="result-header">
                        <Tag
                          color={
                            workspace.result.http_status < 400
                              ? "success"
                              : "error"
                          }
                        >
                          HTTP {workspace.result.http_status}
                        </Tag>
                        <span>{workspace.result.duration_ms} ms</span>
                        <Button
                          onClick={() => {
                            const blob = new Blob(
                                [
                                  JSON.stringify(
                                    workspace.result?.body,
                                    null,
                                    2,
                                  ),
                                ],
                                { type: "application/json" },
                              ),
                              url = URL.createObjectURL(blob),
                              a = document.createElement("a");
                            a.href = url;
                            a.download = "zlink-response.json";
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          {t("api.download")}
                        </Button>
                      </div>
                      <pre className="raw-json">
                        {JSON.stringify(workspace.result.body, null, 2)}
                      </pre>
                    </div>
                  )}
                {workspace.tab === "response" &&
                  !workspace.result &&
                  !workspace.error && (
                    <Empty description={t("api.noResponse")} />
                  )}{" "}
                {workspace.tab === "history" && (
                  <>
                    <p className="cell-muted">{t("api.historyHint")}</p>
                    <Table
                      rowKey="id"
                      dataSource={workspace.history.filter(
                        (item) => item.operation_id === operation.id,
                      )}
                      pagination={{ pageSize: 10 }}
                      scroll={{ x: 600 }}
                      columns={[
                        {
                          title: t("table.event"),
                          dataIndex: "operation_id",
                          render: (value) =>
                            label(
                              catalog!.operations.find(
                                (op) => op.id === value,
                              ) || {
                                id: String(value),
                                title: String(value),
                                sections: [],
                                source: "",
                              },
                            ),
                        },
                        { title: "HTTP", dataIndex: "http_status" },
                        { title: t("api.code"), dataIndex: "response_code" },
                        {
                          title: t("api.duration"),
                          dataIndex: "duration_ms",
                          render: (value) => `${value} ms`,
                        },
                        {
                          title: t("api.date"),
                          dataIndex: "created_at",
                          render: (value) =>
                            new Intl.DateTimeFormat(
                              language === "en"
                                ? "en-US"
                                : language === "hi"
                                  ? "hi-IN"
                                  : "es-PE",
                              {
                                dateStyle: "short",
                                timeStyle: "medium",
                                timeZone: "America/Lima",
                              },
                            ).format(new Date(String(value))),
                        },
                      ]}
                    />
                  </>
                )}
                {workspace.tab === "guides" && (
                  <div className="guide-list">
                    {catalog?.guides.map((guide) => (
                      <a
                        key={guide.id}
                        href={guide.source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <BookOutlined />
                        <span>{label(guide)}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <Empty description={t("api.choose")} />
          )}
        </section>
      </div>
    </>
  );
}
