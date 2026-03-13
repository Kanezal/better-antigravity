/**
 * Better Antigravity - Auto-Scroller Payload
 * 
 * Injected into workbench.html to observe DOM mutations and force
 * the chat container AND all scrollable ancestor containers to scroll
 * to the bottom during AI generation.
 * 
 * Identifies the chat content area by structural pattern matching:
 * looks for the conversation container by its layout classes and
 * walks up the DOM to discover every scrollable ancestor.
 */
(function() {
    console.log('[Better Antigravity] Auto-scroller payload initialized');

    let chatContainer = null;
    let scrollableContainers = []; // chat container + all scrollable ancestors
    let observer = null;
    let isUserScrolling = false;
    let scrollTimeout = null;
    let scrollDebounce = null;

    // ─── Structural Selectors ───────────────────────────────────────
    // We match by structure, not by a single class name, so the fix
    // survives Antigravity CSS refactors.  Priority order:
    //   1. Known class combo from DOM inspection
    //   2. Fallback: any deeply-nested scrollable container with
    //      multiple child divs that have explicit heights (chat turns)
    const CHAT_SELECTORS = [
        '.relative.flex.flex-col.gap-y-3.px-4',     // current Antigravity DOM structure
        '.antigravity-chat-scroll-area',              // SPEC.md legacy selector (keep as fallback)
    ];

    /**
     * Try each selector in priority order, return the first match.
     */
    function findChatContainer() {
        for (const sel of CHAT_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) {
                console.log('[Better Antigravity] Chat container found via:', sel);
                return el;
            }
        }
        return null;
    }

    /**
     * Walk up the DOM from an element and collect all scrollable ancestors.
     * An element is "scrollable" if its scrollHeight exceeds its clientHeight
     * by more than 1px (accounting for sub-pixel rounding).
     */
    function findScrollableAncestors(element) {
        const ancestors = [];
        let current = element.parentElement;

        while (current && current !== document.documentElement) {
            const style = window.getComputedStyle(current);
            const overflowY = style.overflowY;
            const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
                && current.scrollHeight > current.clientHeight + 1;
            
            if (isScrollable) {
                ancestors.push(current);
            }
            current = current.parentElement;
        }

        return ancestors;
    }

    /**
     * Scroll ALL tracked containers to the absolute bottom using requestAnimationFrame.
     */
    function scrollToBottom() {
        if (!chatContainer || isUserScrolling) return;

        if (scrollDebounce) {
            cancelAnimationFrame(scrollDebounce);
        }

        scrollDebounce = requestAnimationFrame(() => {
            for (const container of scrollableContainers) {
                container.scrollTop = container.scrollHeight;
            }
        });
    }

    /**
     * Detect if the user is scrolling manually up on ANY tracked container.
     * If they are near the bottom (within ~50px) on all containers, resume auto-scrolling.
     * Otherwise, pause it so they can read history.
     */
    function handleManualScroll() {
        if (scrollableContainers.length === 0) return;

        // Check if ANY container is scrolled away from bottom
        let anyScrolledUp = false;
        for (const container of scrollableContainers) {
            const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (distanceToBottom > 50) {
                anyScrolledUp = true;
                break;
            }
        }

        isUserScrolling = anyScrolledUp;

        // Reset the "active scrolling" detection after they stop scrolling for a bit
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            let stillScrolledUp = false;
            for (const container of scrollableContainers) {
                const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
                if (dist > 50) {
                    stillScrolledUp = true;
                    break;
                }
            }
            isUserScrolling = stillScrolledUp;
        }, 150);
    }

    /**
     * Start observing the chat container and set up scroll listeners on all
     * scrollable containers (inner + ancestors).
     */
    function observeChatContainer() {
        if (observer) {
            observer.disconnect();
        }

        // Remove old scroll listeners
        for (const container of scrollableContainers) {
            container.removeEventListener('scroll', handleManualScroll);
        }

        // Discover all scrollable containers: chat container itself + scrollable ancestors
        const ancestors = findScrollableAncestors(chatContainer);
        
        // Also check if the chat container itself is scrollable
        const chatStyle = window.getComputedStyle(chatContainer);
        const chatScrollable = (chatStyle.overflowY === 'auto' || chatStyle.overflowY === 'scroll')
            && chatContainer.scrollHeight > chatContainer.clientHeight + 1;
        
        scrollableContainers = chatScrollable ? [chatContainer, ...ancestors] : [...ancestors];

        // If no scrollable ancestors found, still add the first parent with overflow
        if (scrollableContainers.length === 0) {
            let current = chatContainer.parentElement;
            while (current && current !== document.documentElement) {
                if (current.scrollHeight > current.clientHeight + 1) {
                    scrollableContainers.push(current);
                    break;
                }
                current = current.parentElement;
            }
        }

        console.log(`[Better Antigravity] Tracking ${scrollableContainers.length} scrollable container(s)`);

        observer = new MutationObserver(() => {
            // Re-check scrollable ancestors periodically since they change
            // as content grows (e.g. a container becomes scrollable after
            // enough messages are added)
            const freshAncestors = findScrollableAncestors(chatContainer);
            if (freshAncestors.length !== ancestors.length) {
                // New scrollable containers appeared — update listeners
                for (const container of scrollableContainers) {
                    container.removeEventListener('scroll', handleManualScroll);
                }
                scrollableContainers = chatScrollable ? [chatContainer, ...freshAncestors] : [...freshAncestors];
                for (const container of scrollableContainers) {
                    container.addEventListener('scroll', handleManualScroll, { passive: true });
                }
            }

            scrollToBottom();
        });

        observer.observe(chatContainer, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // Setup scroll event listener on ALL scrollable containers
        for (const container of scrollableContainers) {
            container.addEventListener('scroll', handleManualScroll, { passive: true });
        }

        scrollToBottom(); // Do an initial scroll just in case
    }

    /**
     * The chat container may not exist on load, or might be destroyed/recreated.
     * Watch the whole document body to find it when it appears.
     */
    const rootObserver = new MutationObserver((mutations, obs) => {
        const found = findChatContainer();
        if (found && found !== chatContainer) {
            chatContainer = found;
            observeChatContainer();
        } else if (!found && chatContainer) {
            // Container was removed — clean up listeners
            if (observer) observer.disconnect();
            for (const container of scrollableContainers) {
                container.removeEventListener('scroll', handleManualScroll);
            }
            chatContainer = null;
            scrollableContainers = [];
        }
    });

    rootObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Check if it's already there
    const initialContainer = findChatContainer();
    if (initialContainer) {
        chatContainer = initialContainer;
        observeChatContainer();
    }
})();
