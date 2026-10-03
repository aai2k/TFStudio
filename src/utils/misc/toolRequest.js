/**
 * A window asking the workspace to open another tool window, or to bring it
 * forward when it is open already. Windows are not handed the workspace, so the
 * request goes as a window event, which useWorkspaceLayout.js answers.
 */
export const OPEN_TOOL_EVENT = 'tfstudio:open-tool';

export function requestTool(toolId) {
    window.dispatchEvent(new CustomEvent(OPEN_TOOL_EVENT, { detail: { toolId } }));
}
