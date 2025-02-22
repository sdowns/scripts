// ==UserScript==
// @name         Kindle Library Downloader Paged
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Automate downloading books from Kindle library
// @author       You
// @match        https://www.amazon.com/hz/mycd/digital-console/contentlist/booksPurchases/*
// @grant        GM_download
// @grant        window.close
// @grant        GM.xmlHttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @downloadstart
// ==/UserScript==

(function() {
    'use strict';

    // Add this near the top of the script, after 'use strict';
    const CONFIG = {
        testMode: false,  // Set to true to only download 1 book per page
        debugLogging: false  // Enable extra debug logging
    };

    // Add a button to start the download process
    const addDownloadButton = () => {
        const button = document.createElement('button');
        button.innerHTML = 'Download Library';
        button.style.position = 'fixed';
        button.style.top = '10px';
        button.style.right = '10px';
        button.style.zIndex = '9999';
        button.onclick = startDownloadProcess;
        document.body.appendChild(button);

        const resetButton = document.createElement('button');
        resetButton.innerHTML = 'Reset Progress';
        resetButton.style.position = 'fixed';
        resetButton.style.top = '40px';
        resetButton.style.right = '10px';
        resetButton.style.zIndex = '9999';
        resetButton.onclick = resetProgress;
        document.body.appendChild(resetButton);
    };

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const findElementByText = (text, tag = '*') => {
        const elements = document.getElementsByTagName(tag);
        for (const element of elements) {
            if (element.textContent.includes(text)) {
                return element;
            }
        }
        return null;
    };

    const waitForElement = async (selector, text = null, maxAttempts = 10) => {
        console.log(`Waiting for element: selector="${selector}", text="${text}"`);

        for (let i = 0; i < maxAttempts; i++) {
            let elements;

            try {
                // Handle jQuery-style :contains selector
                if (selector.includes(':contains')) {
                    const pureSelector = selector.replace(/:contains\(['"](.*?)['"]\)/, '');
                    const searchText = selector.match(/:contains\(['"](.*?)['"]\)/)[1];
                    elements = Array.from(document.querySelectorAll(pureSelector))
                        .filter(el => el.textContent.includes(searchText));
                } else {
                    elements = Array.from(document.querySelectorAll(selector));
                }

                // If looking for specific text
                if (text) {
                    elements = elements.filter(el => el.textContent.includes(text));
                }

                if (elements.length > 0) {
                    console.log(`Found ${elements.length} matching elements:`, elements);
                    return elements[0];
                }
            } catch (error) {
                console.error('Error in waitForElement:', error);
            }

            console.log(`Attempt ${i + 1}/${maxAttempts}: No matching elements found`);
            await wait(1000); // Increased wait time between attempts
        }

        console.log('Failed to find element after all attempts');
        return null;
    };

    // Add this helper function near the top with your other helpers
    const debugElement = (element, label = 'Element') => {
        if (!element) {
            console.log(`${label} not found`);
            return;
        }

        const computedStyle = window.getComputedStyle(element);
        const inlineStyle = element.getAttribute('style');

        console.log(`${label} Debug Info:`, {
            element: element,
            id: element.id,
            className: element.className,
            textContent: element.textContent,
            inlineStyle: inlineStyle,
            computedStyles: {
                opacity: computedStyle.opacity,
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                background: computedStyle.background,
                backgroundImage: computedStyle.backgroundImage,
                cursor: computedStyle.cursor,
                pointerEvents: computedStyle.pointerEvents
            },
            boundingRect: element.getBoundingClientRect(),
            isVisible: element.offsetParent !== null,
            attributes: Array.from(element.attributes).map(attr => `${attr.name}="${attr.value}"`),
            parentElement: element.parentElement ? {
                tagName: element.parentElement.tagName,
                id: element.parentElement.id,
                className: element.parentElement.className
            } : null
        });
    };

    const waitForDynamicContent = async (timeout = 10000) => {
        return new Promise((resolve) => {
            let timer;
            const observer = new MutationObserver((mutations, obs) => {
                // Look for added nodes that might be our dialog
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length) {
                        const addedDialog = Array.from(mutation.addedNodes).find(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                return node.classList.contains('a-modal-scroller') ||
                                       node.classList.contains('a-modal') ||
                                       (node.getAttribute('role') === 'dialog' && !node.id.startsWith('nav-flyout-'));
                            }
                            return false;
                        });
                        if (addedDialog) {
                            obs.disconnect();
                            clearTimeout(timer);
                            resolve(addedDialog);
                            return;
                        }
                    }
                }
            });

            // Start observing
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Set timeout
            timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    };

    // Add this new function to handle a single book download
    const downloadBook = async (bookContainer) => {
        try {
            // Get the book ID from the container
            const bookId = bookContainer.querySelector('[id^="content-title-"]')?.id?.split('-')[2];
            console.log('Processing book ID:', bookId);

            if (!bookId) {
                console.log('Could not find book ID');
                return false;
            }

            // Find and click More Actions button using the dropdown title div
            const moreActionsContainer = bookContainer.querySelector('[id="MORE_ACTION:false"]');
            if (!moreActionsContainer) {
                console.log('Could not find More Actions container');
                return false;
            }

            const dropdownTitle = moreActionsContainer.querySelector('#dd_title');
            if (!dropdownTitle) {
                console.log('Could not find dropdown title');
                return false;
            }

            console.log('Clicking More Actions dropdown...');
            dropdownTitle.click();
            await wait(500);

            // Get fresh reference to container after clicking More Actions
            const containerAfterMenu = document.querySelector(`.DigitalEntitySummary-module__container_3pUojes0Jk94VKwEcoGXyq [id^="content-title-${bookId}"]`)?.closest('.DigitalEntitySummary-module__container_3pUojes0Jk94VKwEcoGXyq');

            // Find download option within the refreshed container
            const downloadOption = Array.from(containerAfterMenu.querySelectorAll('span'))
                .find(span => span.textContent === 'Download & transfer via USB');
            if (!downloadOption) {
                console.log('Could not find Download option in container');
                return false;
            }

            const clickableElement = downloadOption.closest('a, button, div[role="menuitem"]') || downloadOption;
            clickableElement.click();
            await wait(500);

            // Wait for and find the dialog using the book ID
            const dialogId = `DOWNLOAD_AND_TRANSFER_DIALOG_${bookId}`;
            const dialog = document.getElementById(dialogId);
            if (!dialog) {
                console.log(`Could not find dialog with ID: ${dialogId}`);
                return false;
            }
            console.log('Found dialog:', dialog);

            // Look specifically for the radio button for this book within the dialog
            const radioButtonInDialog = dialog.querySelector(`#download_and_transfer_list_${bookId}_0`);
            if (!radioButtonInDialog) {
                console.log(`Could not find radio button for book ${bookId}`);
                return false;
            }

            console.log('Found radio button:', radioButtonInDialog);
            radioButtonInDialog.click();
            await wait(500);

            // Get fresh reference to dialog after clicking radio button
            const refreshedDialog = document.getElementById(dialogId);
            if (!refreshedDialog) {
                console.log(`Could not find refreshed dialog with ID: ${dialogId}`);
                return false;
            }

            // After clicking radio, look for the download button within the refreshed dialog
            // that has no opacity style set (meaning it's active)
            const buttons = refreshedDialog.querySelectorAll('div[tabindex="0"][id$="_CONFIRM"]');
            const downloadButton = Array.from(buttons).find(button => {
                // Check if the button has no inline opacity style
                return !button.style.opacity && button.querySelector('span')?.textContent === 'Download';
            });

            if (!downloadButton) {
                console.log('Could not find active download button');
                return false;
            }

            console.log('Found active download button:', downloadButton);
            downloadButton.click();
            await wait(500);

            return true;
        } catch (error) {
            console.error('Error in downloadBook:', error);
            return false;
        }
    };

    const waitForDownloadComplete = async () => {
        // Brief wait for download to start
        await wait(100);

        // Look for and click the notification close button
        const notificationClose = document.querySelector('#notification-close');
        if (notificationClose) {
            console.log('Closing notification...');
            notificationClose.click();
            await wait(25); // Brief wait for notification to close
        }

        // Look for any open dialogs
        const dialogs = document.querySelectorAll('[role="dialog"], .a-modal-scroller');
        if (dialogs.length > 0) {
            console.log('Waiting for dialogs to close...');
            await wait(25);
        }

        return true;
    };

    const closeAllMenus = async () => {
        // Click outside any open menus to close them
        document.body.click();
        await wait(100); // Reduced since menu closing is quick

        // Also try closing any open dialogs
        const closeButtons = document.querySelectorAll('button[aria-label="Close"]');
        for (const closeButton of closeButtons) {
            closeButton.click();
            await wait(100); // Reduced per button click
        }
    };

    const getCurrentPageNumber = () => {
        // Look for the active page link
        const activePage = document.querySelector('a.page-item.active, a[class="page-item active"]');
        if (activePage) {
            const pageNum = parseInt(activePage.textContent);
            console.log(`Currently on page ${pageNum}`);
            return pageNum;
        }
        console.log('Could not determine current page number, defaulting to 1');
        return 1;
    };

    const goToNextPage = async () => {
        console.log('Attempting to find next page button...');
        const currentPage = getCurrentPageNumber();
        const nextPageNum = currentPage + 1;

        // Debug: Log all pagination elements
        const paginationDiv = document.querySelector('#pagination');
        console.log('Pagination container:', paginationDiv);
        console.log('Pagination HTML:', paginationDiv?.innerHTML);

        // Get all page links and log them
        const allPageLinks = document.querySelectorAll('a[id^="page-"]');
        console.log('All page links found:', Array.from(allPageLinks).map(link => ({
            id: link.id,
            class: link.className,
            text: link.textContent,
            html: link.innerHTML
        })));

        // Look for the next page number link
        const nextPageButton = document.querySelector(`a#page-${nextPageNum}`);

        if (nextPageButton) {
            console.log(`Found button for page ${nextPageNum}:`, nextPageButton);
            console.log('Next page button properties:', {
                visible: nextPageButton.offsetParent !== null,
                disabled: nextPageButton.hasAttribute('disabled'),
                className: nextPageButton.className,
                innerHTML: nextPageButton.innerHTML,
                href: nextPageButton.href,
                onclick: nextPageButton.onclick,
                // Additional properties
                tagName: nextPageButton.tagName,
                id: nextPageButton.id,
                style: nextPageButton.getAttribute('style'),
                computedDisplay: window.getComputedStyle(nextPageButton).display
            });

            try {
                // Try different click methods
                console.log('Attempting to click next page button...');
                nextPageButton.click();
                console.log('Standard click completed');

                // Fallback click methods if needed
                if (nextPageButton.href) {
                    console.log('Trying href navigation...');
                    window.location.href = nextPageButton.href;
                }

                console.log(`Clicked button for page ${nextPageNum}, waiting for page load...`);
                await wait(2000);

                // Wait for the active page indicator to update
                let attempts = 0;
                while (attempts < 5) {
                    const newPageNum = getCurrentPageNumber();
                    console.log(`Check ${attempts + 1}: Current page number: ${newPageNum}`);

                    if (newPageNum === nextPageNum) {
                        console.log(`Successfully navigated to page ${nextPageNum}`);
                        return true;
                    }

                    await wait(1000);
                    attempts++;
                }

                console.log(`Failed to confirm navigation to page ${nextPageNum}`);
                return false;

            } catch (error) {
                console.error('Error clicking next page button:', error);
                console.error('Error details:', {
                    message: error.message,
                    stack: error.stack
                });
                return false;
            }
        } else {
            console.log(`No button found for page ${nextPageNum} - Details:`);
            console.log('Attempted selector:', `a#page-${nextPageNum}`);
            console.log('Current page elements:', document.body.innerHTML);
        }

        console.log(`No button found for page ${nextPageNum} - reached last page`);
        return false;
    };

    // Modify startDownloadProcess to use testMode
    const startDownloadProcess = async () => {
        try {
            let hasMorePages = true;
            let pageNumber = getCurrentPageNumber();

            while (hasMorePages) {
                console.log(`Processing page ${pageNumber}`);

                // Find all book containers on current page
                const bookContainers = Array.from(
                    document.querySelectorAll('.DigitalEntitySummary-module__container_3pUojes0Jk94VKwEcoGXyq')
                );

                console.log(`Found ${bookContainers.length} books to process on page ${pageNumber}`);

                // In test mode, only process the first book
                const booksToProcess = CONFIG.testMode ? 1 : bookContainers.length;
                console.log(`Will process ${booksToProcess} books (testMode: ${CONFIG.testMode})`);

                // Process books on current page
                for (let i = 0; i < booksToProcess; i++) {
                    await closeAllMenus();
                    await wait(100);

                    const bookTitle = `Book ${i + 1} on page ${pageNumber}`;
                    console.log(`Processing ${bookTitle} (${i + 1} of ${booksToProcess})`);

                    const success = await downloadBook(bookContainers[i]);

                    if (success) {
                        console.log(`Successfully processed ${bookTitle}`);
                        await waitForDownloadComplete();
                    } else {
                        console.log(`Failed to process ${bookTitle}`);
                    }

                    await wait(100);
                }

                // Try to go to next page
                console.log('Attempting to move to next page...');
                hasMorePages = await goToNextPage();
                if (hasMorePages) {
                    pageNumber++;
                    console.log(`Successfully moved to page ${pageNumber}`);
                    // Wait for new page to load completely
                    await wait(2000);
                } else {
                    console.log('Could not move to next page, ending process');
                }
            }

            console.log('Finished processing all pages');
            GM_notification({
                text: `Finished downloading books from all pages (testMode: ${CONFIG.testMode})`,
                title: 'Download Complete',
                timeout: 5000
            });

        } catch (error) {
            console.error('Error in download process:', error);
            GM_notification({
                text: 'Error occurred while downloading books',
                title: 'Download Error',
                timeout: 5000
            });
        }
    };

    // Helper function to get element selectors
    const logElementInfo = () => {
        const inspectButton = document.createElement('button');
        inspectButton.innerHTML = 'Inspect Elements';
        inspectButton.style.position = 'fixed';
        inspectButton.style.top = '50px';
        inspectButton.style.right = '10px';
        inspectButton.style.zIndex = '9999';

        inspectButton.onclick = () => {
            const moreActionsButtons = Array.from(document.querySelectorAll('span')).filter(span =>
                span.textContent === 'More actions'
            );
            console.log('More Actions buttons found:', moreActionsButtons.length);

            if (moreActionsButtons.length > 0) {
                const firstButton = moreActionsButtons[0];
                console.log('First More Actions button:', firstButton);
                firstButton.click();

                setTimeout(() => {
                    const downloadOption = Array.from(document.querySelectorAll('span')).find(span =>
                        span.textContent === 'Download & transfer via USB'
                    );
                    console.log('Download option:', downloadOption);
                }, 1000);
            }
        };

        document.body.appendChild(inspectButton);
    };

    // Add a function to reset progress if needed
    const resetProgress = () => {
        GM_deleteValue('processedBooks');
        console.log('Progress reset - will reprocess all books');
    };

    // Start by adding both buttons
    addDownloadButton();
    logElementInfo();
})();