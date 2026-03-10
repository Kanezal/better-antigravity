/**
 * Better Antigravity - Auto-Scroller Payload
 * 
 * Injected into workbench.html to observe DOM mutations and force
 * the chat container AND all scrollable ancestor containers to scroll
 * to the bottom during AI generation.
 * 
 * Walks up the DOM from .antigravity-chat-scroll-area to discover every
 * scrollable parent, so both the inner and outer scrollbars stay pinned.
 */
(function() {
    console.log('[Better Antigravity] Auto-scroller payload initialized');

    let chatContainer = null;
    let scrollableContainers = []; // chat container + all scrollable ancestors
    let observer = null;
    let isUserScrolling = false;
    let scrollTimeout = null;
    let scrollDebounce = null;

    // The chat area class (defined in SPEC.md)
    const CHAT_SELECTOR = '.antigravity-chat-scroll-area';

    /**
     * Walk up the DOM from an element and collect all scrollable ancestors.
     * An element is "scrollable" if its scrollHeight exceeds its clientHeight
     * by more than 1px (accounting for sub-pixel rounding).
     */
    function findScrollableAncestors(element) {
        const ancestors = [];
        let current = element.parentElement;

        while (current && current !== document.documentElement) {
            // Check if this element is actually scrollable
            if (current.scrollHeight > current.clientHeight + 1) {
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
        scrollableContainers = [chatContainer, ...ancestors];

        console.log(`[Better Antigravity] Found ${scrollableContainers.length} scrollable container(s) (1 chat + ${ancestors.length} ancestor(s))`);

        observer = new MutationObserver(() => {
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
        const found = document.querySelector(CHAT_SELECTOR);
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
    const initialContainer = document.querySelector(CHAT_SELECTOR);
    if (initialContainer) {
        chatContainer = initialContainer;
        observeChatContainer();
    }
})();
