import { Button, Empty, Progress, Table } from "antd";
import type { TableColumnsType } from "antd";
import { ArrowRightOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
export function Dashboard<T extends { request_id: string }>({
  summary,
  items,
  columns,
  loading,
  onExplore,
}: {
  summary: { total: number; event_codes: { code: string; count: number }[] };
  items: T[];
  columns: TableColumnsType<T>;
  loading: boolean;
  onExplore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="dashboard-grid">
      <section className="event-panel dashboard-types">
        <div className="panel-title">
          <div>
            <h2>{t("dashboard.distribution")}</h2>
            <p>{t("dashboard.distributionHint")}</p>
          </div>
          <ThunderboltOutlined />
        </div>
        <div className="type-bars">
          {summary.event_codes.length ? (
            summary.event_codes.map((item) => (
              <div key={item.code}>
                <div className="type-bar-label">
                  <span>{item.code}</span>
                  <strong>{item.count}</strong>
                </div>
                <Progress
                  percent={
                    summary.total
                      ? Math.round((item.count / summary.total) * 100)
                      : 0
                  }
                  showInfo={false}
                  strokeColor="#247fa8"
                />
              </div>
            ))
          ) : (
            <Empty description={t("summary.none")} />
          )}
        </div>
      </section>
      <section className="event-panel dashboard-shortcuts">
        <div className="panel-title">
          <div>
            <h2>{t("dashboard.integration")}</h2>
            <p>{t("dashboard.integrationHint")}</p>
          </div>
        </div>
        <div className="shortcut-body">
          <TagLine label={t("dashboard.source")} value="ZKBio Zlink" />
          <TagLine
            label={t("dashboard.receiver")}
            value="https://zlink.trok.dev/webhooks/zlink"
          />
          <TagLine
            label={t("dashboard.storage")}
            value={t("dashboard.storageValue")}
          />
          <Button onClick={onExplore} icon={<ArrowRightOutlined />}>
            {t("dashboard.explore")}
          </Button>
        </div>
      </section>
      <section className="event-panel dashboard-recent">
        <div className="panel-title">
          <div>
            <h2>{t("dashboard.recent")}</h2>
            <p>{t("dashboard.recentHint")}</p>
          </div>
          <Button type="link" onClick={onExplore}>
            {t("dashboard.viewAll")}
          </Button>
        </div>
        <Table<T>
          rowKey="request_id"
          columns={columns}
          dataSource={items.slice(0, 5)}
          loading={loading}
          pagination={false}
          scroll={{ x: 1020 }}
        />
      </section>
    </div>
  );
}
function TagLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="shortcut-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
