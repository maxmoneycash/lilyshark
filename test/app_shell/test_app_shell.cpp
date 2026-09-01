#include "lilyshark/ui/app_shell.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <limits>

namespace {

using namespace lilyshark;

void testRouteClassification()
{
    assert(classifyShellRoute(ShellRoute::Analyzer) == ShellRouteClass::Analyzer);
    assert(classifyShellRoute(ShellRoute::Splash) == ShellRouteClass::Startup);

    constexpr std::array<ShellRoute, 6> onboarding = {{
        ShellRoute::OnboardingWelcome,
        ShellRoute::OnboardingCapabilities,
        ShellRoute::OnboardingNetwork,
        ShellRoute::OnboardingProfile,
        ShellRoute::OnboardingControls,
        ShellRoute::OnboardingReadiness,
    }};
    for (const ShellRoute route : onboarding) {
        assert(classifyShellRoute(route) == ShellRouteClass::Onboarding);
        assert(isOnboardingRoute(route));
    }

    constexpr std::array<ShellRoute, 4> menus = {{
        ShellRoute::Home,
        ShellRoute::RadioProfiles,
        ShellRoute::Settings,
        ShellRoute::ChannelKeys,
    }};
    for (const ShellRoute route : menus) {
        assert(classifyShellRoute(route) == ShellRouteClass::Menu);
        assert(!isOnboardingRoute(route));
    }

    constexpr std::array<ShellRoute, 6> details = {{
        ShellRoute::Storage,
        ShellRoute::DeviceStatus,
        ShellRoute::DisplayInput,
        ShellRoute::Help,
        ShellRoute::About,
        ShellRoute::RadioTuning,
    }};
    for (const ShellRoute route : details) {
        assert(classifyShellRoute(route) == ShellRouteClass::Detail);
    }

    assert(classifyShellRoute(ShellRoute::ResetConfirmation) ==
           ShellRouteClass::Confirmation);
    assert(classifyShellRoute(ShellRoute::SpectrumConfirmation) ==
           ShellRouteClass::Confirmation);
    assert(classifyShellRoute(ShellRoute::RadioTuning) == ShellRouteClass::Detail);
    assert(classifyShellRoute(ShellRoute::ChannelKeys) == ShellRouteClass::Menu);
    assert(classifyShellRoute(ShellRoute::Count) == ShellRouteClass::Invalid);
    assert(classifyShellRoute(static_cast<ShellRoute>(0xffU)) ==
           ShellRouteClass::Invalid);
}

void testOnboardingTransitions()
{
    AppShell shell{};
    assert(shell.route() == ShellRoute::Splash);
    assert(!shell.canGoBack());

    shell.finishSplash(false);
    assert(shell.route() == ShellRoute::OnboardingWelcome);
    assert(!shell.retreatOnboarding());
    assert(shell.advanceOnboarding());
    assert(shell.route() == ShellRoute::OnboardingCapabilities);
    assert(shell.retreatOnboarding());
    assert(shell.route() == ShellRoute::OnboardingWelcome);
    assert(shell.advanceOnboarding());
    assert(shell.advanceOnboarding());
    assert(shell.route() == ShellRoute::OnboardingNetwork);
    assert(shell.retreatOnboarding());
    assert(shell.route() == ShellRoute::OnboardingCapabilities);
    assert(shell.advanceOnboarding());
    assert(shell.advanceOnboarding());
    assert(shell.route() == ShellRoute::OnboardingProfile);
    assert(shell.advanceOnboarding());
    assert(shell.route() == ShellRoute::OnboardingControls);
    assert(shell.retreatOnboarding());
    assert(shell.route() == ShellRoute::OnboardingProfile);
    assert(shell.advanceOnboarding());
    assert(shell.advanceOnboarding());
    assert(shell.route() == ShellRoute::OnboardingReadiness);
    assert(shell.retreatOnboarding());
    assert(shell.route() == ShellRoute::OnboardingControls);
    assert(shell.advanceOnboarding());
    assert(shell.advanceOnboarding());
    assert(shell.route() == ShellRoute::Home);
    assert(!shell.canGoBack());
    assert(!shell.advanceOnboarding());

    shell.beginOnboarding();
    assert(shell.route() == ShellRoute::OnboardingWelcome);
    shell.finishSplash(true);
    assert(shell.route() == ShellRoute::Home);
}

void testWrappedSelections()
{
    AppShell shell{};

    shell.moveHomeSelection(SelectionMove::Previous);
    assert(shell.homeSelection() == HomeItem::Timeline);
    shell.moveHomeSelection(SelectionMove::Next);
    assert(shell.homeSelection() == HomeItem::Traffic);
    shell.setHomeSelection(std::numeric_limits<std::size_t>::max());
    assert(static_cast<std::size_t>(shell.homeSelection()) <
           static_cast<std::size_t>(HomeItem::Count));

    shell.moveSettingsSelection(SelectionMove::Previous);
    assert(shell.settingsSelection() == SettingsItem::ChannelKeys);
    shell.moveSettingsSelection(SelectionMove::Next);
    assert(shell.settingsSelection() == SettingsItem::RadioProfiles);
    shell.setSettingsSelection(std::numeric_limits<std::size_t>::max());
    assert(static_cast<std::size_t>(shell.settingsSelection()) <
           static_cast<std::size_t>(SettingsItem::Count));

    shell.setProfileSelection(99U, 5U);
    assert(shell.profileSelection() == 4U);
    shell.moveProfileSelection(SelectionMove::Next, 5U);
    assert(shell.profileSelection() == 0U);
    shell.moveProfileSelection(SelectionMove::Previous, 5U);
    assert(shell.profileSelection() == 4U);
    shell.setProfileSelection(std::numeric_limits<std::size_t>::max(), 1U);
    assert(shell.profileSelection() == 0U);
    shell.moveProfileSelection(SelectionMove::Next, 0U);
    assert(shell.profileSelection() == 0U);
}

void testBoundedBackStack()
{
    AppShell shell{};
    shell.finishSplash(true);
    assert(shell.open(ShellRoute::Settings));
    assert(shell.open(ShellRoute::Storage));
    assert(shell.open(ShellRoute::Help));
    assert(shell.open(ShellRoute::About));

    ShellRoute target = ShellRoute::Analyzer;
    assert(shell.backTarget(target));
    assert(target == ShellRoute::Help);
    assert(shell.goBack() && shell.route() == ShellRoute::Help);
    assert(shell.goBack() && shell.route() == ShellRoute::Storage);
    assert(shell.goBack() && shell.route() == ShellRoute::Settings);
    assert(shell.goBack() && shell.route() == ShellRoute::Home);
    assert(!shell.goBack());
    assert(!shell.backTarget(target));

    assert(shell.open(ShellRoute::Settings));
    assert(shell.open(ShellRoute::Settings));
    assert(shell.goBack());
    assert(shell.route() == ShellRoute::Home);

    assert(!shell.open(ShellRoute::Count));
    assert(!shell.replace(static_cast<ShellRoute>(0xffU)));
    assert(shell.route() == ShellRoute::Home);

    constexpr std::array<ShellRoute, 2> alternating = {{
        ShellRoute::Help,
        ShellRoute::About,
    }};
    for (std::size_t index = 0U; index < AppShell::kBackStackCapacity; ++index) {
        assert(shell.open(alternating[index % alternating.size()]));
    }
    const ShellRoute full_route = shell.route();
    assert(!shell.open(ShellRoute::Storage));
    assert(shell.route() == full_route);

    shell.closeToAnalyzer();
    assert(shell.route() == ShellRoute::Analyzer);
    assert(!shell.canGoBack());
}

void testSettingsTargets()
{
    assert(routeForSettingsItem(SettingsItem::RadioProfiles) == ShellRoute::RadioProfiles);
    assert(routeForSettingsItem(SettingsItem::Storage) == ShellRoute::Storage);
    assert(routeForSettingsItem(SettingsItem::DeviceStatus) == ShellRoute::DeviceStatus);
    assert(routeForSettingsItem(SettingsItem::DisplayInput) == ShellRoute::DisplayInput);
    assert(routeForSettingsItem(SettingsItem::Help) == ShellRoute::Help);
    assert(routeForSettingsItem(SettingsItem::About) == ShellRoute::About);
    assert(routeForSettingsItem(SettingsItem::ResetSetup) == ShellRoute::ResetConfirmation);
    assert(routeForSettingsItem(SettingsItem::RadioTuning) == ShellRoute::RadioTuning);
    assert(routeForSettingsItem(SettingsItem::ChannelKeys) == ShellRoute::ChannelKeys);
    assert(routeForSettingsItem(SettingsItem::Count) == ShellRoute::Settings);
    assert(routeForSettingsItem(static_cast<SettingsItem>(0xffU)) == ShellRoute::Settings);
}

} // namespace

int main()
{
    testRouteClassification();
    testOnboardingTransitions();
    testWrappedSelections();
    testBoundedBackStack();
    testSettingsTargets();
    std::puts("app shell tests passed");
    return 0;
}
