-- Check available properties of Terminal tabs

tell application "Terminal"
    -- Create a test window
    set testWindow to do script "echo 'Test Tab'"
    
    -- Get properties of the first tab
    set tabProps to properties of tab 1 of window 1
    
    -- Convert record to string for display
    set AppleScript's text item delimiters to ", "
    display dialog "Tab properties: " & (tabProps as string)
end tell