/**
 * Everything the shell draws on top of the workspace: the settings and about
 * dialogs, the wizards that build a design, the welcome screen with the tour
 * and the tutorials, the prompt dialog and the message strip.
 *
 * Each one is its own fixed-position overlay, so they are siblings of the
 * workspace rather than children of any pane.
 */

import { MessageNotification } from './ui/MessageNotification.js';
import { SettingsModal } from './dialogs/settings/SettingsModal.js';
import { InputDialog } from './dialogs/InputDialog.js';
import { AboutDialog } from './dialogs/AboutDialog.js';
import { DesignImportDialog } from './dialogs/designImport/DesignImportDialog.js';
import { FilterDesignWizard } from './windows/optimization/filterDesignWizard/FilterDesignWizard.js';
import { BBMWizard } from './windows/simulation/bbmWizard/BBMWizard.js';
import { MonoWizard } from './windows/simulation/monoWizard/MonoWizard.js';
import { StackFormulaDialog } from './windows/design/stackFormula/StackFormulaDialog.js';
import { WelcomeScreen } from './dialogs/WelcomeScreen.js';
import { GuidedTour } from './GuidedTour.js';
import { TutorialsBrowser } from './dialogs/TutorialsBrowser.js';
import { TutorialPlayer } from './TutorialPlayer.js';
import { MaterialResolutionModalGuard } from './materials/MaterialResolutionModalGuard.js';

const { createElement: h, Fragment } = React;

export function AppModals({
    c, t, settings, dialogs, welcome, project, dirtyDesigns, activeDesignId,
    designSig, designLayers, onUserPathChanged,
    inputDialog, messageNotification, onDismissMessage,
}) {
    return h(Fragment, null,
        dialogs.showSettings && h(SettingsModal, {
            c, t,
            theme: settings.theme, setTheme: settings.setTheme,
            locale: settings.locale, setLocale: settings.setLocale,
            wasmTmm: settings.wasmTmm, setWasmTmm: settings.setWasmTmm,
            updateCheckEnabled: settings.updateCheckEnabled,
            setUpdateCheckEnabled: settings.setUpdateCheckEnabled,
            onUserPathChanged,
            // A move relocates every design on disk, so any unsaved design blocks it.
            canChangeUserPath: () => !Object.values(dirtyDesigns).some(Boolean),
            ribbonStyle: settings.ribbonStyle, setRibbonStyle: settings.setRibbonStyle,
            quickAccess: settings.quickAccess, setQuickAccess: settings.setQuickAccess,
            customThemes: settings.customThemes,
            onImportTheme: settings.importThemeFromVscode,
            onDeleteTheme: settings.deleteCustomTheme,
            onClose: () => dialogs.setShowSettings(false),
        }),
        dialogs.showAbout && h(AboutDialog, { c, t, onClose: () => dialogs.setShowAbout(false) }),
        project.designImport && h(DesignImportDialog, {
            c, t,
            fileImport: project.designImport,
            setFileImport: project.setDesignImport,
            folders: project.folders,
            defaultFolderId: project.selectedFolder?.id,
            onCommit: project.commitDesignImport,
        }),
        dialogs.showFilterDesign && h(FilterDesignWizard, {
            c, t,
            folderName: project.selectedFolder?.name,
            onClose: () => dialogs.setShowFilterDesign(false),
            onGenerate: (design) => { project.addItemFromDesign(design); }
        }),
        dialogs.showBBM && h(MaterialResolutionModalGuard, {
            c, t, onClose: () => dialogs.setShowBBM(false),
        }, h(BBMWizard, {
            c, t, onClose: () => dialogs.setShowBBM(false),
        })),
        dialogs.showMono && h(MaterialResolutionModalGuard, {
            c, t, onClose: () => dialogs.setShowMono(false),
        }, h(MonoWizard, {
            c, t, onClose: () => dialogs.setShowMono(false),
        })),
        dialogs.showStackFormula && h(MaterialResolutionModalGuard, {
            c, t, onClose: () => dialogs.setShowStackFormula(false),
        }, h(StackFormulaDialog, {
            c, t,
            folderName: project.selectedFolder?.name,
            hasActiveDesign: activeDesignId != null,
            onClose: () => dialogs.setShowStackFormula(false),
            onCreateNew: (design) => { project.addItemFromDesign(design); }
        })),
        // ── First-run welcome screen + guided tour ──
        welcome.showWelcome && h(WelcomeScreen, {
            c, t,
            samples: welcome.sampleDesigns,
            theme: settings.theme, setTheme: settings.setTheme,
            locale: settings.locale, setLocale: settings.setLocale,
            onNewDesign:  welcome.welcomeNewDesign,
            onOpenSample: welcome.welcomeOpenSample,
            onDocs:       welcome.welcomeDocs,
            onTour:       welcome.startTour,
            onTutorials:  welcome.openTutorials,
            onClose:      welcome.closeWelcome,
        }),
        welcome.showTour && h(GuidedTour, {
            c, t,
            onClose: () => welcome.setShowTour(false),
        }),
        welcome.showTutorials && h(TutorialsBrowser, {
            c, t,
            lessons: welcome.tutorials,
            doneKeys: welcome.tutorialsDone,
            onStart: welcome.startLesson,
            onClose: () => welcome.setShowTutorials(false),
        }),
        welcome.activeTutorial && h(TutorialPlayer, {
            c, t,
            lesson: welcome.activeTutorial,
            designSig,
            designLayers,
            onAction: welcome.onTutorialAction,
            onComplete: welcome.markTutorialDone,
            onClose: () => welcome.setActiveTutorial(null),
        }),
        h(InputDialog, { inputDialog, c, t }),
        messageNotification && h(MessageNotification, {
            c,
            message: messageNotification.message,
            type: messageNotification.type,
            onClose: onDismissMessage,
        })
    );
}
