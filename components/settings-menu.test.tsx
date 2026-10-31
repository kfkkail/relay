import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./dashboard";
import { SettingsMenu } from "./settings-menu";

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/my-work",
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function dashboard() {
  return renderToStaticMarkup(
    <Dashboard
      initialTasks={[]}
      initialWorkers={[]}
      initialOwnerActions={[]}
      userEmail="test@example.com"
      initialArea="my-work"
      initialTaskFilter="ready"
      initialMyWorkFilter="active"
      initialTaskId={null}
      initialActionId={null}
      initialReturnTo={null}
      initialTaskActionId={null}
    />,
  );
}

describe("Worker setup from settings", () => {
  beforeEach(() => {
    navigation.query = "";
  });

  it("links non-dashboard views directly to the setup dialog", () => {
    const html = renderToStaticMarkup(
      <SettingsMenu userEmail="test@example.com" />,
    );
    expect(html).toContain('href="/my-work?settings=worker"');
  });

  it("opens the dialog when arriving from another view", () => {
    navigation.query = "settings=worker&status=active";
    expect(dashboard()).toContain('aria-labelledby="worker-title"');
  });

  it.each(["", "settings=unknown", "status=active"])(
    "keeps setup closed without an explicit request (%s)",
    (query) => {
      navigation.query = query;
      expect(dashboard()).not.toContain('aria-labelledby="worker-title"');
    },
  );
});
