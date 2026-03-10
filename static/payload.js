/**
 * Better Antigravity - Auto-Scroller Payload
 * 
 * Injected into workbench.html to observe DOM mutations and force
 * the chat container to scroll to the bottom during AI generation.
 */
(function() {
    console.log('[Better Antigravity] Auto-scroller payload initialized');

    let chatContainer = null;
    let observer = null;
    let isUserScrolling = false;
    let scrollTimeout = null;
    let scrollDebounce = null;

    // The chat area class (defined in SPEC.md)
    const CHAT_SELECTOR = '.antigravity-chat-scroll-area';

    /**
     * Scroll the container to the absolute bottom safely using requestAnimationFrame
     */
    function scrollToBottom() {
        if (!chatContainer || isUserScrolling) return;

        if (scrollDebounce) {
            cancelAnimationFrame(scrollDebounce);
        }

        scrollDebounce = requestAnimationFrame(() => {
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        });
    }

    /**
     * Start observing the specific chat container
     */
    function observeChatContainer() {
        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver(() => {
            scrollToBottom();
        });

        observer.observe(chatContainer, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // Setup scroll event listener to detect manual scrolling
        chatContainer.addEventListener('scroll', handleManualScroll, { passive: true });
        
        console.log('[Better Antigravity] Observing chat container for mutations');
        scrollToBottom(); // Do an initial scroll just in case
    }

    /**
     * Detect if the user is scrolling manually up.
     * If they are near the bottom (within ~50px), resume auto-scrolling.
     * Otherwise, pause it so they can read history.
     */
    function handleManualScroll() {
        if (!chatContainer) return;

        const distanceToBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
        
        // If user is within 50px of the bottom, they are "at the bottom"
        // and we can safely auto-scroll again.
        if (distanceToBottom > 50) {
            isUserScrolling = true;
        } else {
            isUserScrolling = false;
        }

        // Reset the "active scrolling" detection after they stop scrolling for a bit
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            // Re-evaluate their position after scrolling stops
            const newDistance = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
            isUserScrolling = newDistance > 50;
        }, 150);
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
            // Container was removed
            if (observer) observer.disconnect();
            chatContainer = null;
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
