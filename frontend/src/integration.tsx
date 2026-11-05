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
  Select,
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

function Base64Image(props: WidgetProps) {
  const { t } = useTranslation(),
    { message } = App.useApp();
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
          reader.onload = () =>
            props.onChange(String(reader.result).split(",")[1]);
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
        placeholder={t("api.base64")}
      />
    </div>
  );
}

export function Integration({
  account,
  onExpired,
}: {
  account: Account;
  onExpired: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage === "en" ? "en" : "es";
  const { modal } = App.useApp();
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState<string | undefined>(),
    [inputs, setInputs] = useState<Record<string, unknown>>({}),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("request"),
    [history, setHistory] = useState<Record<string, unknown>[]>([]),
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
          setSelected(
            c.operations.find((x) => x.kind === "connection")?.id ||
              c.operations[0]?.id ||
              "",
          );
        }
      })
      .catch((e) => {
        if (e.status === 401) onExpired();
        else if (active) setError(errorKey(e));
      });
    return () => {
      active = false;
    };
  }, [onExpired]);
  const operation = catalog?.operations.find((item) => item.id === selected);
  const validator = useMemo(
    () => customizeValidator({}, language === "es" ? localizeEs : undefined),
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
  async function refreshHistory() {
    try {
      setHistory(
        (
          await api<{ items: Record<string, unknown>[] }>(
            "/integration/history",
          )
        ).items,
      );
    } catch (e) {
      if ((e as { status?: number }).status === 401) onExpired();
    }
  }
  async function execute(data: Record<string, unknown>, confirmed = false) {
    if (!operation) return;
    if (operation.kind === "mutation" && !confirmed) {
      modal.confirm({
        title: t("api.confirmTitle"),
        content: t("api.confirmBody", { name: label(operation) }),
        okText: t("api.confirmExecute"),
        cancelText: t("common.cancel"),
        okButtonProps: { danger: true },
        onOk: () => execute(data, true),
      });
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await api<Result>(`/integration/execute/${operation.id}`, {
        method: "POST",
        body: JSON.stringify({ inputs: data, confirmed }),
      });
      setResult(r);
      await refreshHistory();
    } catch (e) {
      if ((e as { status?: number }).status === 401) onExpired();
      else setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string) {
    setSelected(id);
    setInputs({});
    setResult(null);
    setError("");
    setTab("request");
  }
  const canExecute =
    operation &&
    account.permissions.includes(
      operation.kind === "mutation" ? "api.write" : "api.read",
    );
  const filtered =
    catalog?.operations.filter(
      (op) =>
        (!group || op.sections[0] === group) &&
        `${label(op)} ${op.path} ${op.method}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
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
          loading={busy}
          disabled={!connection || !account.permissions.includes("api.read")}
          onClick={() => {
            if (connection) {
              choose(connection.id);
              setSelected(connection.id);
            }
          }}
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
      <div className="api-layout">
        <aside className="event-panel api-navigation">
          <div className="api-search">
            <Input.Search
              placeholder={t("api.search")}
              aria-label={t("api.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              allowClear
              placeholder={t("api.allGroups")}
              aria-label={t("api.allGroups")}
              value={group}
              onChange={setGroup}
              options={[
                ...new Set(catalog?.operations.map((op) => op.sections[0])),
              ].map((value) => ({
                value,
                label: t("sections." + value, { defaultValue: value }),
              }))}
            />
          </div>
          <div className="operation-list">
            {filtered.map((op) => (
              <button
                key={op.id}
                className={selected === op.id ? "selected" : ""}
                onClick={() => choose(op.id)}
              >
                <span>
                  <Tag color={op.kind === "mutation" ? "orange" : "blue"}>
                    {op.method}
                  </Tag>
                  <span className="cell-muted">
                    {t("sections." + op.sections[0], {
                      defaultValue: op.sections[0],
                    })}
                  </span>
                </span>
                <strong>{label(op)}</strong>
              </button>
            ))}
          </div>
        </aside>
        <section className="event-panel api-workbench">
          {operation ? (
            <>
              <div className="panel-title">
                <div>
                  <h2>{label(operation)}</h2>
                  <p>
                    <Tag
                      color={operation.kind === "mutation" ? "orange" : "blue"}
                    >
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
                  activeKey={tab}
                  onChange={(value) => {
                    setTab(value);
                    if (value === "history") void refreshHistory();
                  }}
                  items={[
                    { key: "request", label: t("api.request") },
                    { key: "response", label: t("api.response") },
                    { key: "history", label: t("api.history") },
                    { key: "guides", label: t("api.guides") },
                  ]}
                />
                {tab === "request" && (
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
                          base64: Base64Image,
                          numberInput: NumericInput,
                        }}
                        formData={inputs}
                        onChange={(event) => setInputs(event.formData || {})}
                        onSubmit={(event) => void execute(event.formData || {})}
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
                          loading={busy}
                          disabled={!canExecute}
                        >
                          {t("api.execute")}
                        </Button>
                      </JsonForm>
                    )}
                    {operation.kind === "connection" && (
                      <Button
                        type="primary"
                        loading={busy}
                        disabled={!canExecute}
                        onClick={() => void execute({})}
                        icon={<PlayCircleOutlined />}
                      >
                        {t("api.execute")}
                      </Button>
                    )}
                    <Space wrap className="api-form-actions">
                      {operation.example !== null && (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setInputs({ body: operation.example });
                            setResult(null);
                          }}
                        >
                          {t("api.example")}
                        </Button>
                      )}
                      <Button
                        onClick={() => {
                          setInputs({});
                          setResult(null);
                          setError("");
                        }}
                        disabled={busy}
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
                {error && (
                  <Alert
                    type="error"
                    showIcon
                    title={t(error)}
                    className="data-error"
                  />
                )}
                {(tab === "response" || tab === "request") && result && (
                  <div className="api-result">
                    <div className="result-header">
                      <Tag
                        color={result.http_status < 400 ? "success" : "error"}
                      >
                        HTTP {result.http_status}
                      </Tag>
                      <span>{result.duration_ms} ms</span>
                      <Button
                        onClick={() => {
                          const blob = new Blob(
                              [JSON.stringify(result.body, null, 2)],
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
                      {JSON.stringify(result.body, null, 2)}
                    </pre>
                  </div>
                )}
                {tab === "response" && !result && !error && (
                  <Empty description={t("api.noResponse")} />
                )}{" "}
                {tab === "history" && (
                  <>
                    <p className="cell-muted">{t("api.historyHint")}</p>
                    <Table
                      rowKey="id"
                      dataSource={history}
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
                              language === "en" ? "en-US" : "es-PE",
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
                {tab === "guides" && (
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
