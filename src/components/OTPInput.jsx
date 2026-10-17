import React, { useState, useRef, useEffect } from 'react';

const OTPInput = ({ length = 6, onComplete }) => {
    const [otp, setOtp] = useState(new Array(length).fill(""));
    const inputs = useRef([]);

    useEffect(() => {
        if (inputs.current[0]) {
            inputs.current[0].focus();
        }
    }, []);

    const handleChange = (element, index) => {
        if (isNaN(element.value)) return false;

        const newOtp = [...otp];
        newOtp[index] = element.value;
        setOtp(newOtp);

        // Move to next input if value is entered
        if (element.value !== "" && index < length - 1) {
            inputs.current[index + 1].focus();
        }

        // Check if all fields are filled
        if (newOtp.every(val => val !== "")) {
            onComplete(newOtp.join(""));
        }
    };

    const handleKeyDown = (e, index) => {
        if (e.key === "Backspace" && !otp[index] && index > 0) {
            inputs.current[index - 1].focus();
        }
    };

    const handlePaste = (e) => {
        const data = e.clipboardData.getData("text").slice(0, length);
        if (isNaN(data)) return;

        const newOtp = data.split("");
        setOtp([...newOtp, ...new Array(length - newOtp.length).fill("")]);

        if (newOtp.length === length) {
            onComplete(data);
        } else {
            inputs.current[newOtp.length].focus();
        }
    };

    return (
        // dir="ltr": the OTP is a numeric code (read left-to-right even in Arabic),
        // so the segmented row keeps its visual order and matches the code shown
        // in the demo box / email. All handlers below are untouched.
        <div className="flex justify-center gap-2 sm:gap-3 mb-6" dir="ltr">
            {otp.map((data, index) => (
                <input
                    key={index}
                    type="text"
                    inputMode="numeric"
                    maxLength="1"
                    className="w-12 h-14 text-center text-xl font-semibold text-slate-900 bg-white border border-slate-200 rounded-xl transition-all duration-200 hover:border-slate-300 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    value={data}
                    onChange={e => handleChange(e.target, index)}
                    onKeyDown={e => handleKeyDown(e, index)}
                    onPaste={handlePaste}
                    ref={el => inputs.current[index] = el}
                />
            ))}
        </div>
    );
};

export default OTPInput;
