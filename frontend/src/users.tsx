import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { PlusOutlined, EditOutlined, TeamOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api, errorKey } from "./api";
export type Account = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "reader" | "custom";
  permissions: string[];
  active: boolean;
  created_at: string;
};
export function UserManagement({
  account,
  onExpired,
}: {
  account: Account;
  onExpired: () => void;
}) {
  const { t } = useTranslation(),
    { message } = App.useApp();
  const [form] = Form.useForm();
  const [rows, setRows] = useState<Account[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Account | null>(null),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const role = Form.useWatch("role", form);
  useEffect(() => {
    let active = true;
    setBusy(true);
    api<{ items: Account[]; total: number }>(`/users?page=${page}`)
      .then((r) => {
        if (active) {
          setRows(r.items);
          setTotal(r.total);
          setError("");
        }
      })
      .catch((e) => {
        if (e.status === 401) onExpired();
        else if (active) setError(errorKey(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [page, tick, onExpired]);
  function edit(user: Account | null) {
    setEditing(user);
    setSaveError("");
    form.resetFields();
    form.setFieldsValue(
      user
        ? { ...user, password: undefined }
        : { role: "reader", permissions: ["events.read"], active: true },
    );
    setOpen(true);
  }
  async function save() {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    setSaveError("");
    const payload = { ...values, password: values.password || undefined };
    try {
      await api(editing ? `/users/${editing.id}` : "/users", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setOpen(false);
      setTick((x) => x + 1);
      message.success(t(editing ? "users.updated" : "users.created"));
      if (editing?.id === account.id) onExpired();
    } catch (e) {
      setSaveError(errorKey(e));
    } finally {
      setSaving(false);
    }
  }
  if (!account.permissions.includes("users.manage"))
    return <Alert type="warning" title={t("errors.forbidden")} />;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="page-kicker">
            <TeamOutlined /> TROK
          </div>
          <h1>{t("users.title")}</h1>
          <p>{t("users.description")}</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => edit(null)}
        >
          {t("users.create")}
        </Button>
      </div>
      {error && <Alert type="error" title={t(error)} className="data-error" />}
      <section className="event-panel">
        <Table<Account>
          rowKey="id"
          dataSource={rows}
          loading={busy}
          scroll={{ x: 700 }}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
          columns={[
            { title: t("login.username"), dataIndex: "username" },
            { title: t("users.name"), dataIndex: "display_name" },
            {
              title: t("users.role"),
              dataIndex: "role",
              render: (value) => (
                <Tag color={value === "admin" ? "blue" : "default"}>
                  {t("roles." + value)}
                </Tag>
              ),
            },
            {
              title: t("users.permissions"),
              dataIndex: "permissions",
              render: (values: string[]) => (
                <Space wrap>
                  {values.map((value) => (
                    <Tag key={value}>{t("permissions." + value)}</Tag>
                  ))}
                </Space>
              ),
            },
            {
              title: t("table.status"),
              dataIndex: "active",
              render: (value) => (
                <Tag color={value ? "success" : "default"}>
                  {t(value ? "users.active" : "users.inactive")}
                </Tag>
              ),
            },
            {
              title: "",
              render: (_, row) => (
                <Button icon={<EditOutlined />} onClick={() => edit(row)}>
                  {t("users.edit")}
                </Button>
              ),
            },
          ]}
        />
      </section>
      <Modal
        open={open}
        title={t(editing ? "users.edit" : "users.create")}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText={t("users.save")}
        cancelText={t("common.cancel")}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          preserve={false}
        >
          {saveError && (
            <Alert
              type="error"
              showIcon
              title={t(saveError)}
              className="form-alert"
            />
          )}
          <Form.Item
            name="username"
            label={t("login.username")}
            rules={[
              { required: true, message: t("login.usernameRequired") },
              {
                pattern: /^[a-zA-Z0-9_.-]{3,64}$/,
                message: t("users.usernameRule"),
              },
            ]}
          >
            <Input disabled={!!editing} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="display_name"
            label={t("users.name")}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("users.nameRequired"),
              },
              { max: 100 },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={t(editing ? "users.newPassword" : "login.password")}
            extra={editing ? t("users.passwordHint") : undefined}
            rules={[
              { required: !editing, message: t("login.passwordRequired") },
              { min: 8, message: t("users.passwordRule") },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="role"
            label={t("users.role")}
            rules={[{ required: true }]}
          >
            <Select
              disabled={editing?.id === account.id}
              options={["reader", "admin", "custom"].map((value) => ({
                value,
                label: t("roles." + value),
              }))}
              onChange={(value) =>
                form.setFieldValue(
                  "permissions",
                  value === "admin"
                    ? ["events.read", "users.manage", "api.read", "api.write"]
                    : value === "reader"
                      ? ["events.read"]
                      : [],
                )
              }
            />
          </Form.Item>
          <Form.Item
            name="permissions"
            label={t("users.permissions")}
            extra={t("users.permissionHint")}
          >
            <Checkbox.Group
              disabled={role !== "custom"}
              options={[
                "events.read",
                "users.manage",
                "api.read",
                "api.write",
              ].map((value) => ({
                value,
                label: t("permissions." + value),
              }))}
            />
          </Form.Item>
          {editing && (
            <Form.Item
              name="active"
              label={t("users.active")}
              valuePropName="checked"
            >
              <Switch disabled={editing.id === account.id} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
